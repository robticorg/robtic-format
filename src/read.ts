import { unzipSync } from 'fflate';
import { ASSET_TYPES, DEFAULT_LIMITS, FORMAT, MANIFEST_FILE, type Limits } from './constants.ts';
import { RobticError } from './errors.ts';
import { canonicalJson, sha256 } from './hash.ts';
import { wrongPlaceMessage, type Kind } from './kinds.ts';
import { integrityScope, REF_GROUPS, type Manifest } from './manifest.ts';
import { collectPointers, findRef } from './refs.ts';
import { findSecret } from './secrets.ts';
import { isZip, matchesType } from './sniff.ts';

export interface ReadAsset {
    bytes: Uint8Array;
    type: string;
    size: number;
    sha256: string;
    name?: string;
}

export interface RobticFile<D = unknown> {
    manifest: Manifest<D>;
    packed: boolean;
    /** Attached files by key ("a1"), already checked against their SHA-256. */
    assets: Map<string, ReadAsset>;
}

/** A JSON file from before .robtic existed. The page decides how to upgrade `raw`. */
export interface LegacyFile {
    legacy: true;
    raw: unknown;
}

export interface ReadOptions {
    /** The kind(s) this page imports. Anything else fails with 'wrong-kind' and a "open it in …" message. */
    kind?: Kind | readonly Kind[];
    limits?: Partial<Limits>;
}

type Input = Uint8Array | ArrayBuffer | Blob;

/** Reads and fully checks a .robtic file. Throws RobticError with a message meant for the person importing. */
export async function readRobtic<D = unknown>(input: Input, opts: ReadOptions = {}): Promise<RobticFile<D>> {
    const r = await readRobticOrLegacy<D>(input, opts);
    if ('legacy' in r) throw new RobticError('not-robtic', 'This isn\'t a .robtic file.');
    return r;
}

/** Like readRobtic, but a plain JSON file without the .robtic header comes back as { legacy: true, raw }. */
export async function readRobticOrLegacy<D = unknown>(input: Input, opts: ReadOptions = {}): Promise<RobticFile<D> | LegacyFile> {
    const limits = { ...DEFAULT_LIMITS, ...opts.limits };
    const bytes = await toBytes(input, limits);

    let manifestBytes: Uint8Array;
    let files: Record<string, Uint8Array> = {};
    const packed = isZip(bytes);
    if (packed) {
        files = unpack(bytes, limits);
        const m = files[MANIFEST_FILE];
        if (!m) throw new RobticError('damaged', 'The file is missing its robtic.json.');
        manifestBytes = m;
    } else {
        manifestBytes = bytes;
    }
    if (manifestBytes.length > limits.manifestBytes) throw new RobticError('too-big', 'The content is too large.');

    let raw: unknown;
    try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes).replace(/^﻿/, ''));
    } catch {
        throw new RobticError(packed ? 'damaged' : 'not-robtic', packed ? 'The file is damaged.' : 'This isn\'t a .robtic file.');
    }
    if (!isObject(raw)) throw new RobticError('not-robtic', 'This isn\'t a .robtic file.');
    if (!('format' in raw) && !('$robtic' in raw)) {
        if (packed) throw new RobticError('damaged', 'The file is damaged.');
        return { legacy: true, raw };
    }

    const manifest = checkShape(raw);
    if (manifest.format > FORMAT) throw new RobticError('unsupported', 'This file was made by a newer version of Robtic. Refresh the page and try again.');

    const wanted = opts.kind === undefined ? null : typeof opts.kind === 'string' ? [opts.kind] : opts.kind;
    if (wanted && !wanted.includes(manifest.kind as Kind)) throw new RobticError('wrong-kind', wrongPlaceMessage(manifest.kind), manifest.kind);

    const expected = await sha256(canonicalJson(integrityScope(manifest)));
    if (expected !== manifest.integrity.sha256) throw new RobticError('damaged', 'The file was changed or damaged after it was exported.');

    const secret = findSecret({ meta: manifest.meta, refs: manifest.refs, data: manifest.data });
    if (secret) throw new RobticError('secret', `This file contains ${secret.what}, so it won't be imported.`);

    const used = collectPointers(manifest.data);
    for (const k of used.refs) if (!findRef(manifest.refs, k)) throw new RobticError('damaged', 'The file is damaged (a missing role or channel).');
    for (const k of used.assets) if (!(k in manifest.assets)) throw new RobticError('damaged', 'The file is damaged (a missing file).');

    const assets = new Map<string, ReadAsset>();
    const entries = Object.entries(manifest.assets);
    if (entries.length && !packed) throw new RobticError('damaged', 'The file\'s pictures are missing.');
    if (entries.length > limits.assets) throw new RobticError('too-big', `More than ${limits.assets} files.`);
    const claimed = new Set<string>([MANIFEST_FILE]);
    for (const [key, a] of entries) {
        const ext = ASSET_TYPES[a.type];
        if (!ext) throw new RobticError('unsafe', `The file includes a type that isn't allowed (${a.type}).`);
        if (a.file !== `assets/${a.sha256}.${ext}`) throw new RobticError('damaged', 'The file is damaged (a file is misnamed).');
        const b = files[a.file];
        if (!b) throw new RobticError('damaged', `The file is damaged (${a.name ?? a.file} is missing).`);
        if (b.length !== a.size || b.length > limits.assetBytes) throw new RobticError('damaged', `The file is damaged (${a.name ?? 'a file'} has the wrong size).`);
        if ((await sha256(b)) !== a.sha256) throw new RobticError('damaged', `${a.name ?? 'A file'} was changed or damaged.`);
        if (!matchesType(a.type, b)) throw new RobticError('unsafe', `${a.name ?? 'A file'} isn't really a ${ext.toUpperCase()} file.`);
        claimed.add(a.file);
        assets.set(key, { bytes: b, type: a.type, size: a.size, sha256: a.sha256, ...(a.name ? { name: a.name } : {}) });
    }
    for (const f of Object.keys(files)) if (!claimed.has(f)) throw new RobticError('unsafe', 'The file contains something that doesn\'t belong in a .robtic file.');

    return { manifest: manifest as Manifest<D>, packed, assets };
}

async function toBytes(input: Input, limits: Limits): Promise<Uint8Array> {
    const size = input instanceof Uint8Array ? input.length : input instanceof ArrayBuffer ? input.byteLength : input.size;
    if (size > limits.fileBytes) throw new RobticError('too-big', `The file is over ${Math.round(limits.fileBytes / 1024 / 1024)} MB.`);
    if (size === 0) throw new RobticError('not-robtic', 'The file is empty.');
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(await input.arrayBuffer());
}

const ENTRY_NAME = /^(?:robtic\.json|assets\/[0-9a-f]{64}\.[a-z0-9]{1,5})$/;

/** Only "stored" (uncompressed) entries with expected names: no zip bombs, no paths outside the archive. */
function unpack(bytes: Uint8Array, limits: Limits): Record<string, Uint8Array> {
    let problem: RobticError | null = null;
    let count = 0;
    let total = 0;
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(bytes, {
            filter(f) {
                if (problem) return false;
                count++;
                total += f.originalSize;
                if (!ENTRY_NAME.test(f.name)) problem = new RobticError('unsafe', 'The file contains something that doesn\'t belong in a .robtic file.');
                else if (f.compression !== 0) problem = new RobticError('unsafe', 'The file was packed in a way .robtic doesn\'t allow.');
                else if (count > limits.assets + 1) problem = new RobticError('too-big', `More than ${limits.assets} files.`);
                else if (f.originalSize !== f.size) problem = new RobticError('damaged', 'The file is damaged.');
                else if (f.originalSize > Math.max(limits.assetBytes, limits.manifestBytes) || total > limits.fileBytes) problem = new RobticError('too-big', 'The file is too large.');
                return !problem;
            },
        });
    } catch {
        throw new RobticError('damaged', 'The file is damaged.');
    }
    if (problem) throw problem;
    return files;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** The manifest has every field with the right type. Anything else is a damaged file. */
function checkShape(m: Record<string, unknown>): Manifest {
    const bad = (what: string) => new RobticError('damaged', `The file is damaged (${what}).`);
    if (typeof m.format !== 'number' || !Number.isInteger(m.format) || m.format < 1) throw bad('format');
    if (!isStr(m.kind) || !m.kind) throw bad('kind');
    if (typeof m.kindVersion !== 'number' || !Number.isInteger(m.kindVersion) || m.kindVersion < 1) throw bad('kindVersion');
    const meta = m.meta;
    if (!isObject(meta) || !isStr(meta.name) || !isStr(meta.createdAt)) throw bad('meta');
    if (!isObject(m.refs)) throw bad('refs');
    for (const [group, list] of Object.entries(m.refs)) {
        if (!(REF_GROUPS as readonly string[]).includes(group) || !isObject(list)) throw bad('refs');
        for (const e of Object.values(list)) if (!isObject(e) || !isStr(e.name)) throw bad('refs');
    }
    if (!isObject(m.assets)) throw bad('assets');
    for (const a of Object.values(m.assets)) {
        if (!isObject(a) || !isStr(a.file) || !isStr(a.type) || typeof a.size !== 'number' || !isStr(a.sha256) || !/^[0-9a-f]{64}$/.test(a.sha256)) throw bad('assets');
    }
    if (!('data' in m)) throw bad('data');
    if (!isObject(m.integrity) || !isStr(m.integrity.sha256)) throw bad('integrity');
    return m as unknown as Manifest;
}
