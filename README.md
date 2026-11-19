# @robtic/format

Reader and writer for **`.robtic` files**, the one file type for everything people export from and import into
Robtic: auto replies, panels, AutoMod templates, ticket settings and panels, staff ladders, and later whole-server
bundles. The format itself is described in [SPEC.md](SPEC.md); the manifest's JSON Schema is
[schema/v1.json](schema/v1.json).

- **One extension.** People only ever see `.robtic`. Inside it is JSON text, or a zip when pictures or files come along.
- **Pictures travel inside**, named by SHA-256: stored once, checked on import, never an expiring link.
- **Works on another server.** Roles, channels and emojis are described by name (`refs`), matched on import.
- **Safe to share.** No tokens, webhook links or keys can be written or read; zips are stored-only with fixed paths;
  every picture's first bytes must match its type; a checksum catches edited or damaged files.
- Runs the same in browsers, Bun and Node (Web Crypto + [fflate](https://github.com/101arrowz/fflate)).

## Write

```ts
import { RobticWriter } from '@robtic/format';

const w = new RobticWriter('discord.bot.system.autoreplies', 1, { name: 'Support replies', author: { name: 'robo' } });
const logo = await w.asset(pngBytes, 'image/png', 'logo.png');            // → { $asset: 'a1' }
const role = w.ref('roles', { name: 'Support', id: roleId, server: guildId }); // → { $ref: 'r1' }
const file = await w.build({ rules: [{ triggers: ['hi'], files: [logo], mentionRole: role }] });

download(new Blob([file.bytes], { type: file.mime }), file.fileName); // "support-replies.robtic"
```

## Read

```ts
import { readRobtic, resolvePointers, suggestMatches, RobticError } from '@robtic/format';

try {
    const r = await readRobtic(fileFromInput, { kind: 'discord.bot.system.autoreplies' });

    const guesses = suggestMatches(r.manifest.refs, { serverId, roles, channels }); // { r1: '123…' | null }
    // …show the preview + matching step, upload r.assets (already hash-checked)…
    const data = resolvePointers(r.manifest.data, { ref: (k) => chosen[k] ?? null, asset: (k) => uploadedUrl[k] });
} catch (e) {
    if (e instanceof RobticError) toast(e.message); // written for people: "This is an AutoMod template. Open it in …"
}
```

## Develop

```sh
bun install
bun test
bun run typecheck
```

Changing the outer shape of the file means a new `FORMAT` and a new schema (`v2`); changing what one kind holds
only bumps that kind's `kindVersion`, with an upgrade step in the app that imports it.
