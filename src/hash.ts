/** SHA-256 as lowercase hex. Web Crypto: the same in browsers, Bun and Node. */
export async function sha256(bytes: Uint8Array | string): Promise<string> {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with object keys sorted at every level: the same value always gives the same text, so the same checksum. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) {
            const x = (v as Record<string, unknown>)[k];
            if (x !== undefined) out[k] = sortKeys(x);
        }
        return out;
    }
    return v;
}
