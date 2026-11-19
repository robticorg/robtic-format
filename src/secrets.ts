/**
 * Things that must never travel inside a .robtic file. The writer refuses to write them and the reader refuses
 * files that contain them, so a shared export can't leak a bot or a webhook.
 */
const PATTERNS: { what: string; re: RegExp }[] = [
    { what: 'a Discord bot token', re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/ },
    { what: 'a Discord webhook link', re: /discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+/i },
    { what: 'an API key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z\d]{16,}\b|\bsk-[A-Za-z\d_-]{20,}\b|\bgh[pousr]_[A-Za-z\d]{30,}\b|\bAKIA[A-Z\d]{16}\b/ },
    { what: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Field names that only ever hold secrets. A non-empty string under one of them is refused. */
const SECRET_FIELDS = /^(?:token|bot_?token|access_?token|refresh_?token|client_?secret|secret|password|api_?key|webhook_?url|private_?key)$/i;

/** Where the first secret is, or null. `path` is like "data.rules[2].replies[0].text". */
export function findSecret(value: unknown, path = ''): { path: string; what: string } | null {
    if (typeof value === 'string') {
        for (const p of PATTERNS) if (p.re.test(value)) return { path, what: p.what };
        return null;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const hit = findSecret(value[i], `${path}[${i}]`);
            if (hit) return hit;
        }
        return null;
    }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            const p = path ? `${path}.${k}` : k;
            if (SECRET_FIELDS.test(k) && typeof v === 'string' && v.trim()) return { path: p, what: `a "${k}" value` };
            const hit = findSecret(v, p);
            if (hit) return hit;
        }
    }
    return null;
}
