/** Checks a file's first bytes really match the type it claims, so a renamed program can't pose as a picture. */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
    'image/png': (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/jpeg': (b) => starts(b, [0xff, 0xd8, 0xff]),
    'image/gif': (b) => starts(b, [0x47, 0x49, 0x46, 0x38]),
    'image/webp': (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
    'application/pdf': (b) => starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]),
    'text/plain': (b) => isText(b),
};

export function matchesType(type: string, bytes: Uint8Array): boolean {
    const check = SIGNATURES[type];
    return !!check && check(bytes);
}

function starts(b: Uint8Array, sig: number[]): boolean {
    return b.length >= sig.length && sig.every((x, i) => b[i] === x);
}

/** UTF-8 text with no NUL bytes. */
function isText(b: Uint8Array): boolean {
    if (b.includes(0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(b);
        return true;
    } catch {
        return false;
    }
}

/** A zip starts with "PK\x03\x04" (or "PK\x05\x06" when empty). */
export const isZip = (b: Uint8Array) => starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]);
