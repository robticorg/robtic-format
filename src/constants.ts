/** The container version this library writes. It changes only if the outer shape of a .robtic file changes. */
export const FORMAT = 1;
export const SCHEMA_URL = 'https://robtic.org/schema/v1';
export const EXTENSION = '.robtic';

/** MIME types: a plain file is JSON text, a packed one is a zip holding robtic.json and assets/. */
export const MIME_PLAIN = 'application/vnd.robtic+json';
export const MIME_PACKED = 'application/vnd.robtic+zip';

/** The manifest's name inside a packed file. */
export const MANIFEST_FILE = 'robtic.json';

export interface Limits {
    /** Whole file. */
    fileBytes: number;
    /** One attached file. */
    assetBytes: number;
    /** Number of attached files. */
    assets: number;
    /** The manifest JSON. */
    manifestBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
    fileBytes: 25 * 1024 * 1024,
    assetBytes: 10 * 1024 * 1024,
    assets: 100,
    manifestBytes: 2 * 1024 * 1024,
};

/** File types an asset may be, and the extension it is stored under. */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
};
