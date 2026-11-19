import type { Kind } from './kinds.ts';

/** A role, channel, emoji or member, described so it can be found again on another server. */
export interface RefEntry {
    name: string;
    /** The Discord ID where the file was made: used only when importing back onto the same server. */
    id?: string;
    /** The server (guild) ID where the file was made. */
    server?: string;
    /** Channels: text, voice, category, forum, announcement… */
    type?: string;
    /** Roles: hex colour, shown in the matching step. */
    color?: string;
    /** Emojis. */
    animated?: boolean;
}

export const REF_GROUPS = ['roles', 'channels', 'emojis', 'members'] as const;
export type RefGroup = (typeof REF_GROUPS)[number];
export type Refs = Partial<Record<RefGroup, Record<string, RefEntry>>>;

/** An attached file, stored inside a packed .robtic as assets/<sha256>.<ext>. */
export interface AssetEntry {
    file: string;
    type: string;
    size: number;
    sha256: string;
    /** The original file name, for display. */
    name?: string;
}

export interface Meta {
    name: string;
    description?: string;
    /** ISO 8601. */
    createdAt: string;
    /** Which app wrote it, e.g. "robtic-discord 2026.11.19". */
    createdWith?: string;
    author?: { name?: string; server?: string };
    /** Language of the content: "en", "ar"… */
    lang?: string;
}

export interface Manifest<D = unknown> {
    $robtic: string;
    format: number;
    kind: Kind | (string & {});
    kindVersion: number;
    meta: Meta;
    refs: Refs;
    assets: Record<string, AssetEntry>;
    data: D;
    integrity: { sha256: string };
}

/** What `data` uses instead of a Discord ID: { "$ref": "r1" }. */
export interface RefPointer { $ref: string }
/** What `data` uses instead of a link to a file: { "$asset": "a1" }. */
export interface AssetPointer { $asset: string }

/** The part of the manifest the checksum covers. `meta` is left out so a file can be renamed. */
export const integrityScope = (m: Pick<Manifest, 'kind' | 'kindVersion' | 'refs' | 'assets' | 'data'>) => ({
    kind: m.kind, kindVersion: m.kindVersion, refs: m.refs, assets: m.assets, data: m.data,
});
