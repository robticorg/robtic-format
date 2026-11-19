# The `.robtic` file format

One file type for everything people export from or import into the Robtic dashboards: auto replies, panels,
AutoMod templates, ticket settings, ticket panels, staff ladders, and later whole-server bundles.

Format version **1**. Reference implementation: this repo (`@robtic/format`).

---

## 1. What the user sees

**Always `.robtic`.** The user never sees `.json` or `.zip`.

```
📄 support-replies.robtic          auto replies
📄 support-desk.robtic             a ticket panel
📄 anti-scam.robtic                an AutoMod template
📄 my-server-setup.robtic          a whole server (bundle, later)
```

How a file is stored inside (plain text or a zip with pictures) is an internal detail, the same way a `.docx`
is secretly a zip but Word users only ever see `.docx`.

### Export (example: auto replies)

1. Dashboard → Auto reply → **Export**.
2. The browser downloads `support-replies.robtic`.
3. The user sends it to a friend on Discord, keeps it as a backup, or uploads it to another server.

### Import (example: a friend's ticket panel)

1. Robtic Ticket → Panels → **Import**, pick `support-desk.robtic` (or drag it onto the page).
2. A preview opens. Nothing changes yet:

```
┌──────────────────────────────────────────────────────┐
│  🎫  Ticket panel · "Support desk"                    │
│  Made by robo · Robtic Community · 19 Nov 2026        │
│  3 options · 1 form · 2 pictures                      │
│                                                      │
│  Match to your server                                │
│  Support Team (role)      → [ @Support Team ▾ ]  ✓   │
│  open-a-ticket (channel)  → [ #tickets      ▾ ]  ✓   │
│  Tickets (category)       → [ Pick one…     ▾ ]  !   │
│                                                      │
│                       [ Cancel ]  [ Import panel ]   │
└──────────────────────────────────────────────────────┘
```

3. The user fixes anything marked `!`, clicks **Import panel**, then saves as usual.

### Wrong place

Dropping `anti-scam.robtic` into Robtic Ticket shows:
> This is an **AutoMod template**. Open it in Robtic System → AutoMod.

instead of "invalid file".

### Old files

`.json` exports made before this format still import (treated as version 0 and upgraded).

---

## 2. Inside the file

The reader looks at the first bytes and handles either form. The extension is `.robtic` in both cases.

| Inside | When the dashboard writes it | Contents |
|---|---|---|
| **Plain** (JSON text) | No pictures or files at all | One JSON document: the manifest |
| **Packed** (zip) | Any picture or file is used | `robtic.json` (the manifest) + `assets/<sha256>.<ext>` |

```
support-desk.robtic   (packed)
├── robtic.json
└── assets/
    ├── 3f9a…c1.png     named by SHA-256: deduplicated, checkable
    └── 81bd…07.pdf
```

**Pictures and files are always stored inside the `.robtic`, never as CDN links.** Each one is saved under its
SHA-256 hash (`assets/<sha256>.<ext>`), and `data` points to it with `{"$asset": "a1"}`. This replaces the old idea
of exporting cdn.robtic.org links, which expire after 7 days and break the file.

What the hash gives:
- **Never breaks:** the file carries its own pictures, so it works years later, offline, on any server.
- **Stored once:** the same picture used in 10 replies is one file in the zip.
- **Checked:** on import the reader re-hashes every asset; a changed or damaged picture is rejected.
- **No double uploads:** on import the dashboard asks the server which hashes it already has and uploads only the
  missing ones.

The bot still needs the picture on Robtic's server to show it in Discord, so on import each asset is uploaded to
Robtic storage. That storage is keyed by the same SHA-256, so a picture imported twice, or shared by two servers,
is stored once. Files in use are kept; only unused uploads expire.

MIME types: `application/vnd.robtic+json` (plain), `application/vnd.robtic+zip` (packed).

Zip rules (a reader refuses anything else):
- entries are **stored, not compressed** (pictures are already compressed; this makes zip bombs impossible);
- only `robtic.json` and `assets/<64 hex>.<ext>` entries, each listed in the manifest;
- every asset's size and SHA-256 match the manifest, and its first bytes match its type.

---

## 3. The manifest

```json
{
  "$robtic": "https://robtic.org/schema/v1",
  "format": 1,
  "kind": "discord.bot.ticket.panel",
  "kindVersion": 3,

  "meta": {
    "name": "Support desk",
    "description": "A menu with general help, reports and purchases.",
    "createdAt": "2026-11-19T12:00:00Z",
    "createdWith": "robtic-discord 2026.11.19",
    "author": { "name": "robo", "server": "Robtic Community" },
    "lang": "ar"
  },

  "refs": {
    "roles":    { "r1": { "name": "Support Team", "color": "#1793ff", "id": "1234…", "server": "689…" } },
    "channels": { "c1": { "name": "open-a-ticket", "type": "text" },
                  "c2": { "name": "Tickets", "type": "category" } },
    "emojis":   { "e1": { "name": "ticket", "animated": false } }
  },

  "assets": {
    "a1": { "file": "assets/3f9a…c1.png", "type": "image/png", "size": 48211, "sha256": "3f9a…c1" }
  },

  "data": {
    "channelId": { "$ref": "c1" },
    "supportRoleIds": [{ "$ref": "r1" }],
    "image": { "$asset": "a1" }
  },

  "integrity": { "sha256": "…" }
}
```

| Field | Purpose |
|---|---|
| `format` | Version of the container. Changes only if this outer shape changes |
| `kind`, `kindVersion` | What is inside and the version of that kind's shape. Old versions are upgraded on import |
| `meta` | Everything the import preview shows |
| `refs` | Roles, channels and emojis described by name and type (see 4) |
| `assets` | Attached files, always inside the file under their SHA-256. Never external links |
| `data` | The content; shape depends on `kind` |
| `integrity` | Checksum of `data` + `refs` + `assets`: detects damaged or hand-edited files |

---

## 4. `refs`: making a file work on another server

`data` never holds a raw Discord ID. It points to local keys (`{"$ref": "r1"}`), and `refs` describes each one by
name and type. On import the dashboard matches by name (and by ID when it is the same server), shows the match
step, and applies nothing until every reference is matched or explicitly skipped. Missing channels and categories
can be created.

---

## 5. Kinds

Every kind starts with the product, so products never clash. One extension, many kinds: never a second extension.

| Pattern | Examples |
|---|---|
| `discord.bot.<bot>.<what>` | `discord.bot.system.autoreplies`, `discord.bot.ticket.panel` |
| `discord.server.<what>` | `discord.server.bundle` |
| `hosting.<area>.<type>` (future) | `hosting.backup.minecraft`, `hosting.backup.database`, `hosting.node.config` |
| `account.<what>` (future) | `account.profile` |

Rules: segments are lowercase or camelCase words (`^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`). A name never changes
once files exist; a new shape bumps `kindVersion`. Limits can differ per kind (a hosting backup may be far larger
than a panel). A reader that meets a kind it doesn't know still names the product: "This is a Robtic Hosting file."

Kinds in format 1:

| `kind` | Exported from | `data` holds |
|---|---|---|
| `discord.bot.system.autoreplies` | Robtic System → Auto reply | Triggers, replies, weights, options; attachments as assets |
| `discord.bot.system.panels` | Robtic System → Panels | Panel designs; images as assets |
| `discord.bot.system.automodTemplate` | AutoMod → Mine | Words, regex, checks, Robtic Rules, default actions. Open templates only |
| `discord.bot.ticket.settings` | Robtic Ticket → Settings | All settings except where panels are posted |
| `discord.bot.ticket.panel` | A ticket panel | Panel, options, forms, permissions |
| `discord.bot.ticket.infoPanels` | Robtic Ticket → Info panels | Info panels |
| `discord.bot.staff.ladder` | Robtic Staff | Ranks, tiers, point values |
| `discord.bot.voice.musicPanel` | Robtic Voice | Control panel look |
| `discord.server.bundle` | Server → Export (later) | `{ "items": [ { "kind", "kindVersion", "data" } ] }`: a whole server setup ("Robtic environment") |

---

## 6. Rules

- **No secrets, ever:** no tokens, webhook URLs, API keys. The writer strips them; the reader rejects files containing them.
- **No Protected content:** official and Protected AutoMod lists cannot be exported.
- **Limits:** about 25 MB per file, 10 MB per asset, safe types only (images, PDF, TXT). Zip entries are checked
  (count, sizes, paths, compression ratio) before extracting.
- **Preview first:** import never applies anything without the preview and a confirm, followed by a normal save.
- **Backwards compatible:** old `.json` exports import as `format: 0`.

---

## 7. Open questions

1. **Bundle scope:** which bots and settings a whole-server export includes, and whether it is one file or one per bot.
2. **Signing:** should Robtic sign official files so the preview can show "✓ Official Robtic file"?
3. **Limits:** are 25 MB / 10 MB right, or should they follow the CDN limits?
4. **File icon:** register a Robtic icon for `.robtic` on Windows/macOS (only matters if there is ever a desktop app).
5. **Public schema:** publish `robtic.org/schema/v1` so editors can validate and other tools can create files.
