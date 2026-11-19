export type RobticErrorCode =
    | 'not-robtic'        // not a .robtic file at all
    | 'too-big'           // over a size or count limit
    | 'unsupported'       // made by a newer version of Robtic than this reader knows
    | 'damaged'           // broken JSON or zip, missing parts, checksum or hash mismatch
    | 'unsafe'            // a file type, path or zip feature this format never allows
    | 'secret'            // a token, webhook link or key inside
    | 'wrong-kind';       // a valid file, but not what this page imports

/** Every failure while reading or writing a .robtic file. `message` is written for the person importing it. */
export class RobticError extends Error {
    override readonly name = 'RobticError';
    constructor(
        readonly code: RobticErrorCode,
        message: string,
        /** For 'wrong-kind': the kind the file actually holds, so the page can say where to open it. */
        readonly kind?: string,
    ) {
        super(message);
    }
}
