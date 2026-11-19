import type { AssetPointer, RefEntry, RefGroup, RefPointer, Refs } from './manifest.ts';
import { REF_GROUPS } from './manifest.ts';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const isRefPointer = (v: unknown): v is RefPointer =>
    !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as RefPointer).$ref === 'string';

export const isAssetPointer = (v: unknown): v is AssetPointer =>
    !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as AssetPointer).$asset === 'string';

/** Every { $ref } and { $asset } key used in `data`. */
export function collectPointers(data: unknown): { refs: Set<string>; assets: Set<string> } {
    const refs = new Set<string>();
    const assets = new Set<string>();
    const walk = (v: unknown): void => {
        if (isRefPointer(v)) refs.add(v.$ref);
        else if (isAssetPointer(v)) assets.add(v.$asset);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(data);
    return { refs, assets };
}

/**
 * A copy of `data` with every pointer replaced: { $ref: "r1" } → ref("r1") (usually the matched Discord ID, or null
 * when skipped) and { $asset: "a1" } → asset("a1") (usually the uploaded file's link).
 */
export function resolvePointers<T = unknown>(data: unknown, fns: { ref: (key: string) => unknown; asset: (key: string) => unknown }): T {
    const walk = (v: unknown): unknown => {
        if (isRefPointer(v)) return fns.ref(v.$ref);
        if (isAssetPointer(v)) return fns.asset(v.$asset);
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, x] of Object.entries(v)) if (!UNSAFE_KEYS.has(k)) out[k] = walk(x);
            return out;
        }
        return v;
    };
    return walk(data) as T;
}

/** Find a ref key's group and entry. */
export function findRef(refs: Refs, key: string): { group: RefGroup; entry: RefEntry } | null {
    for (const group of REF_GROUPS) {
        const entry = refs[group]?.[key];
        if (entry) return { group, entry };
    }
    return null;
}

export interface ServerItems {
    /** The server being imported into. */
    serverId?: string;
    roles?: { id: string; name: string }[];
    channels?: { id: string; name: string; type?: string }[];
    emojis?: { id: string; name: string }[];
    members?: { id: string; name: string }[];
}

/**
 * First guess for the matching step: the same ID when importing back onto the same server, otherwise the same name
 * (ignoring case; channels must also be the same type when both sides say). null = the person has to pick.
 */
export function suggestMatches(refs: Refs, server: ServerItems): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const group of REF_GROUPS) {
        const items = server[group] ?? [];
        for (const [key, entry] of Object.entries(refs[group] ?? {})) {
            const sameServer = !!entry.id && !!server.serverId && entry.server === server.serverId;
            const byId = sameServer ? items.find((i) => i.id === entry.id) : undefined;
            const name = entry.name.trim().toLowerCase();
            const byName = items.find((i) => i.name.trim().toLowerCase() === name
                && (group !== 'channels' || !entry.type || !('type' in i) || !i.type || i.type === entry.type));
            out[key] = (byId ?? byName)?.id ?? null;
        }
    }
    return out;
}
