import { zipSync } from 'fflate';
import { ASSET_TYPES, DEFAULT_LIMITS, EXTENSION, FORMAT, MANIFEST_FILE, MIME_PACKED, MIME_PLAIN, SCHEMA_URL, type Limits } from './constants.ts';
import { RobticError } from './errors.ts';
import { canonicalJson, sha256 } from './hash.ts';
import type { Kind } from './kinds.ts';
import { integrityScope, type AssetEntry, type AssetPointer, type Manifest, type Meta, type RefEntry, type RefGroup, type RefPointer, type Refs } from './manifest.ts';
import { collectPointers } from './refs.ts';
import { findSecret } from './secrets.ts';
import { matchesType } from './sniff.ts';

const KEY_PREFIX: Record<RefGroup, string> = { roles: 'r', channels: 'c', emojis: 'e', members: 'm' };

export interface BuiltFile {
    bytes: Uint8Array;
    mime: string;
    /** true when it is a zip carrying files. */
    packed: boolean;
    /** A safe download name: "Support desk" → "support-desk.robtic". */
    fileName: string;
    manifest: Manifest;
}

/**
 * Builds one .robtic file.
 *
 *   const w = new RobticWriter('system.autoreplies', 1, { name: 'Support replies' });
 *   const img = await w.asset(bytes, 'image/png', 'logo.png');      // → { $asset: 'a1' }
 *   const role = w.ref('roles', { name: 'Support', id, server });   // → { $ref: 'r1' }
 *   const file = await w.build({ rules: [...] });
 */
export class RobticWriter {
    private readonly refs: Refs = {};
    private readonly assets: Record<string, AssetEntry> = {};
    private readonly assetBytes = new Map<string, Uint8Array>();
    private readonly limits: Limits;
    private readonly meta: Meta;

    constructor(
        private readonly kind: Kind,
        private readonly kindVersion: number,
        meta: Omit<Meta, 'createdAt'> & { createdAt?: string },
        limits: Partial<Limits> = {},
    ) {
        if (!Number.isInteger(kindVersion) || kindVersion < 1) throw new RobticError('damaged', 'kindVersion must be a whole number from 1.');
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        this.meta = { ...meta, createdAt: meta.createdAt ?? new Date().toISOString() };
    }

    /** Adds an attached file. The same bytes added twice are stored once and get the same pointer. */
    async asset(bytes: Uint8Array, type: string, name?: string): Promise<AssetPointer> {
        const ext = ASSET_TYPES[type];
        if (!ext) throw new RobticError('unsafe', `${name ?? 'A file'}: ${type || 'this type'} can't be included. Allowed: PNG, JPG, WEBP, GIF, PDF, TXT.`);
        if (bytes.length > this.limits.assetBytes) throw new RobticError('too-big', `${name ?? 'A file'} is over ${mb(this.limits.assetBytes)}.`);
        if (!matchesType(type, bytes)) throw new RobticError('unsafe', `${name ?? 'A file'} isn't really a ${ext.toUpperCase()} file.`);
        const hash = await sha256(bytes);
        const existing = Object.entries(this.assets).find(([, a]) => a.sha256 === hash);
        if (existing) return { $asset: existing[0] };
        if (Object.keys(this.assets).length >= this.limits.assets) throw new RobticError('too-big', `More than ${this.limits.assets} files.`);
        const key = `a${Object.keys(this.assets).length + 1}`;
        this.assets[key] = { file: `assets/${hash}.${ext}`, type, size: bytes.length, sha256: hash, ...(name ? { name } : {}) };
        this.assetBytes.set(key, bytes);
        return { $asset: key };
    }

    /** Describes a role, channel, emoji or member. The same one (by ID, or by name and type) gets the same pointer. */
    ref(group: RefGroup, entry: RefEntry): RefPointer {
        const list = (this.refs[group] ??= {});
        const found = Object.entries(list).find(([, e]) => entry.id ? e.id === entry.id : !e.id && e.name === entry.name && e.type === entry.type);
        if (found) return { $ref: found[0] };
        const key = `${KEY_PREFIX[group]}${Object.keys(list).length + 1}`;
        list[key] = clean(entry);
        return { $ref: key };
    }

    async build(data: unknown): Promise<BuiltFile> {
        const { refs: usedRefs, assets: usedAssets } = collectPointers(data);
        for (const k of usedRefs) if (!Object.values(this.refs).some((g) => g && k in g)) throw new RobticError('damaged', `data points to ${k}, which was never added with ref().`);
        for (const k of usedAssets) if (!(k in this.assets)) throw new RobticError('damaged', `data points to ${k}, which was never added with asset().`);

        const secret = findSecret({ meta: this.meta, refs: this.refs, data });
        if (secret) throw new RobticError('secret', `Can't export: ${secret.what} is in ${secret.path}. Remove it first.`);

        const body = { kind: this.kind, kindVersion: this.kindVersion, refs: this.refs, assets: this.assets, data };
        const manifest: Manifest = {
            $robtic: SCHEMA_URL,
            format: FORMAT,
            kind: this.kind,
            kindVersion: this.kindVersion,
            meta: this.meta,
            refs: this.refs,
            assets: this.assets,
            data,
            integrity: { sha256: await sha256(canonicalJson(integrityScope(body))) },
        };
        const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
        if (json.length > this.limits.manifestBytes) throw new RobticError('too-big', `The content is over ${mb(this.limits.manifestBytes)}.`);

        const packed = Object.keys(this.assets).length > 0;
        let bytes = json;
        if (packed) {
            const files: Record<string, Uint8Array> = { [MANIFEST_FILE]: json };
            for (const [key, a] of Object.entries(this.assets)) files[a.file] = this.assetBytes.get(key)!;
            // Stored, not compressed: pictures are already compressed, and a reader that only accepts stored
            // entries can never be hit by a "zip bomb".
            bytes = zipSync(files, { level: 0, mtime: new Date('2020-01-01T00:00:00Z') });
        }
        if (bytes.length > this.limits.fileBytes) throw new RobticError('too-big', `The file would be over ${mb(this.limits.fileBytes)}.`);
        return { bytes, mime: packed ? MIME_PACKED : MIME_PLAIN, packed, fileName: robticFileName(this.meta.name), manifest };
    }
}

/** "Support desk!" → "support-desk.robtic". Keeps Arabic and other letters. */
export function robticFileName(name: string): string {
    const base = name.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
    return `${base || 'robtic-export'}${EXTENSION}`;
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function clean<T extends object>(o: T): T {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}
