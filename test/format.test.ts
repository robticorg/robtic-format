import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
    canonicalJson, FORMAT, integrityScope, MIME_PACKED, MIME_PLAIN, readRobtic, readRobticOrLegacy, resolvePointers,
    RobticError, RobticWriter, robticFileName, SCHEMA_URL, sha256, suggestMatches, wrongPlaceMessage, type Manifest,
} from '../src/index.ts';

// Smallest real files of each type (enough to pass the signature check).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const PDF = strToU8('%PDF-1.7\n%fake');
// Built at runtime so no token-shaped text sits in the source.
const FAKE_TOKEN = ['M', 'a'.repeat(25), '.', 'b'.repeat(6), '.', 'c'.repeat(27)].join('');

async function expectCode(p: Promise<unknown>, code: string) {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(RobticError);
        expect((e as RobticError).code).toBe(code as RobticError['code']);
        return e as RobticError;
    }
    throw new Error(`expected ${code}, but it succeeded`);
}

/** A manifest written by hand (bypassing the writer's checks), with a correct checksum. */
async function handMade(over: Partial<Manifest> = {}): Promise<Uint8Array> {
    const m: Manifest = {
        $robtic: SCHEMA_URL, format: FORMAT, kind: 'discord.bot.system.autoreplies', kindVersion: 1,
        meta: { name: 'x', createdAt: '2026-11-19T00:00:00Z' }, refs: {}, assets: {}, data: { rules: [] },
        integrity: { sha256: '' }, ...over,
    };
    m.integrity = { sha256: await sha256(canonicalJson(integrityScope(m))) };
    return strToU8(JSON.stringify(m));
}

describe('writing and reading', () => {
    test('a plain file round-trips', async () => {
        const w = new RobticWriter('discord.bot.ticket.settings', 2, { name: 'My settings', lang: 'en' });
        const role = w.ref('roles', { name: 'Support', id: '111', server: '999', color: '#1793ff' });
        const again = w.ref('roles', { name: 'Support (renamed)', id: '111', server: '999' });
        const ch = w.ref('channels', { name: 'tickets', type: 'category' });
        const file = await w.build({ supportRoles: [role, again], category: ch, prefix: '!' });

        expect(file.packed).toBe(false);
        expect(file.mime).toBe(MIME_PLAIN);
        expect(file.fileName).toBe('my-settings.robtic');
        expect(again).toEqual(role);

        const read = await readRobtic(file.bytes, { kind: 'discord.bot.ticket.settings' });
        expect(read.packed).toBe(false);
        expect(read.manifest.kindVersion).toBe(2);
        expect(read.manifest.refs.roles?.r1).toEqual({ name: 'Support', id: '111', server: '999', color: '#1793ff' });
        expect(read.manifest.data).toEqual({ supportRoles: [{ $ref: 'r1' }, { $ref: 'r1' }], category: { $ref: 'c1' }, prefix: '!' });
    });

    test('a packed file carries its pictures, stored once by SHA-256', async () => {
        const w = new RobticWriter('discord.bot.system.autoreplies', 1, { name: 'Support replies' });
        const a = await w.asset(PNG, 'image/png', 'logo.png');
        const b = await w.asset(PNG, 'image/png', 'logo-copy.png');
        const c = await w.asset(PDF, 'application/pdf', 'rules.pdf');
        expect(b).toEqual(a);
        const file = await w.build({ rules: [{ files: [a, b, c] }] });
        expect(file.packed).toBe(true);
        expect(file.mime).toBe(MIME_PACKED);

        const read = await readRobtic(file.bytes);
        expect(read.assets.size).toBe(2);
        const logo = read.assets.get('a1')!;
        expect(logo.sha256).toBe(await sha256(PNG));
        expect([...logo.bytes]).toEqual([...PNG]);
        expect(read.manifest.assets.a1!.file).toBe(`assets/${await sha256(PNG)}.png`);
    });

    test('reads from a Blob too (what a browser file input gives)', async () => {
        const file = await new RobticWriter('discord.bot.staff.ladder', 1, { name: 'L' }).build({ ranks: [] });
        const read = await readRobtic(new Blob([file.bytes as Uint8Array<ArrayBuffer>]));
        expect(read.manifest.kind).toBe('discord.bot.staff.ladder');
    });
});

describe('pointers and matching', () => {
    test('resolvePointers swaps refs for IDs and assets for links', async () => {
        const data = { role: { $ref: 'r1' }, skip: { $ref: 'c1' }, img: { $asset: 'a1' }, list: [{ $ref: 'r1' }], keep: { $ref: 'r1', other: 1 } };
        const out = resolvePointers(data, { ref: (k) => (k === 'r1' ? '555' : null), asset: () => 'https://images.robtic.org/x.png' });
        expect(out).toEqual({ role: '555', skip: null, img: 'https://images.robtic.org/x.png', list: ['555'], keep: { $ref: 'r1', other: 1 } });
    });

    test('suggestMatches: same server by ID, otherwise by name and channel type', () => {
        const refs = {
            roles: { r1: { name: 'Support', id: '1', server: 'S' }, r2: { name: 'VIP' } },
            channels: { c1: { name: 'Tickets', type: 'category' }, c2: { name: 'tickets', type: 'text' } },
        };
        expect(suggestMatches(refs, {
            serverId: 'S',
            roles: [{ id: '1', name: 'Helpers' }, { id: '2', name: 'vip' }],
            channels: [{ id: '10', name: 'tickets', type: 'text' }],
        })).toEqual({ r1: '1', r2: '2', c1: null, c2: '10' });
        // Another server: the ID means nothing there, so only names count.
        expect(suggestMatches(refs, { serverId: 'T', roles: [{ id: '1', name: 'Helpers' }] }).r1).toBeNull();
    });
});

describe('refuses bad files', () => {
    test('not a .robtic file', async () => {
        await expectCode(readRobtic(strToU8('hello')), 'not-robtic');
        await expectCode(readRobtic(new Uint8Array()), 'not-robtic');
        await expectCode(readRobtic(strToU8('{"rules":[]}')), 'not-robtic');
    });

    test('an old .json export comes back as legacy', async () => {
        const r = await readRobticOrLegacy(strToU8('{"rules":[{"triggers":["hi"]}]}'));
        expect(r).toEqual({ legacy: true, raw: { rules: [{ triggers: ['hi'] }] } });
    });

    test('opened on the wrong page says where it belongs', async () => {
        const file = await new RobticWriter('discord.bot.system.automodTemplate', 1, { name: 'Anti scam' }).build({});
        const e = await expectCode(readRobtic(file.bytes, { kind: ['discord.bot.ticket.panel', 'discord.bot.ticket.settings'] }), 'wrong-kind');
        expect(e.kind).toBe('discord.bot.system.automodTemplate');
        expect(e.message).toBe('This file holds an AutoMod template. Open it in Robtic System → AutoMod.');
        expect(wrongPlaceMessage('discord.bot.ticket.panel')).toBe('This file holds a ticket panel. Open it in Robtic Ticket → Panels.');
        expect(wrongPlaceMessage('discord.bot.ticket.settings')).toBe('This file holds ticket settings. Open it in Robtic Ticket → Settings.');
        // A kind from the future still says which product it belongs to.
        expect(wrongPlaceMessage('hosting.backup.minecraft')).toBe('This is a Robtic Hosting file. Open it in Robtic Hosting.');
        expect(wrongPlaceMessage('spaceship.engine')).toBe('This file was made by a newer version of Robtic. Refresh the page and try again.');
    });

    test('made by a newer Robtic', async () => {
        await expectCode(readRobtic(await handMade({ format: FORMAT + 1 })), 'unsupported');
    });

    test('kind names must follow product.part(.part…)', async () => {
        await expectCode(readRobtic(await handMade({ kind: 'autoreplies' })), 'damaged');
        await expectCode(readRobtic(await handMade({ kind: 'Discord.Bot' })), 'damaged');
        await expectCode(readRobtic(await handMade({ kind: 'discord..x' })), 'damaged');
        // An unknown but well-formed kind reads fine when the page doesn't restrict kinds (e.g. a generic preview).
        expect((await readRobtic(await handMade({ kind: 'hosting.backup.minecraft' }))).manifest.kind).toBe('hosting.backup.minecraft');
    });

    test('content changed after export', async () => {
        const file = await new RobticWriter('discord.bot.system.autoreplies', 1, { name: 'x' }).build({ rules: ['a'] });
        const m = JSON.parse(new TextDecoder().decode(file.bytes));
        m.data.rules.push('b');
        await expectCode(readRobtic(strToU8(JSON.stringify(m))), 'damaged');
        // Renaming is fine: meta isn't covered by the checksum.
        m.data.rules.pop();
        m.meta.name = 'renamed';
        expect((await readRobtic(strToU8(JSON.stringify(m)))).manifest.meta.name).toBe('renamed');
    });

    test('a picture swapped inside the zip', async () => {
        const w = new RobticWriter('discord.bot.system.panels', 1, { name: 'p' });
        const a = await w.asset(PNG, 'image/png');
        const file = await w.build({ img: a });
        const json = JSON.stringify((await readRobtic(file.bytes)).manifest);
        const forged = zipSync({ 'robtic.json': strToU8(json), [`assets/${await sha256(PNG)}.png`]: PNG2 }, { level: 0 });
        await expectCode(readRobtic(forged), 'damaged');
    });

    test('a program posing as a picture', async () => {
        const w = new RobticWriter('discord.bot.system.panels', 1, { name: 'p' });
        await expectCode(w.asset(strToU8('MZ\x90\x00 not a png'), 'image/png', 'evil.png'), 'unsafe');
        await expectCode(w.asset(PNG, 'application/x-msdownload'), 'unsafe');
    });

    test('zip tricks: compressed entries, extra files, odd paths', async () => {
        const json = JSON.stringify((await readRobtic(await handMade())).manifest);
        await expectCode(readRobtic(zipSync({ 'robtic.json': strToU8(json) }, { level: 9 })), 'unsafe');
        await expectCode(readRobtic(zipSync({ 'robtic.json': strToU8(json), 'run.exe': PNG }, { level: 0 })), 'unsafe');
        await expectCode(readRobtic(zipSync({ 'robtic.json': strToU8(json), '../../evil.txt': strToU8('x') }, { level: 0 })), 'unsafe');
        await expectCode(readRobtic(zipSync({ 'other.json': strToU8(json) }, { level: 0 })), 'unsafe');
    });

    test('a plain file that claims pictures', async () => {
        const h = await sha256(PNG);
        await expectCode(readRobtic(await handMade({ assets: { a1: { file: `assets/${h}.png`, type: 'image/png', size: PNG.length, sha256: h } }, data: { img: { $asset: 'a1' } } })), 'damaged');
    });

    test('pointers to things that are not there', async () => {
        await expectCode(readRobtic(await handMade({ data: { role: { $ref: 'r9' } } })), 'damaged');
        await expectCode(new RobticWriter('discord.bot.system.panels', 1, { name: 'p' }).build({ img: { $asset: 'a1' } }), 'damaged');
    });

    test('size limits', async () => {
        await expectCode(readRobtic(new Uint8Array(2048), { limits: { fileBytes: 1024 } }), 'too-big');
        const w = new RobticWriter('discord.bot.system.panels', 1, { name: 'p' }, { assetBytes: 8 });
        await expectCode(w.asset(PNG, 'image/png'), 'too-big');
    });
});

describe('never carries secrets', () => {
    test('the writer refuses tokens, webhooks and secret fields', async () => {
        const w = () => new RobticWriter('discord.bot.system.autoreplies', 1, { name: 'x' });
        await expectCode(w().build({ text: `my token ${FAKE_TOKEN}` }), 'secret');
        await expectCode(w().build({ url: 'https://discord.com/api/webhooks/123/abcDEF_-' }), 'secret');
        await expectCode(w().build({ bot: { token: 'anything' } }), 'secret');
        // An empty token field is fine (a form that was never filled).
        await w().build({ bot: { token: '' } });
    });

    test('the reader refuses hand-made files with secrets', async () => {
        await expectCode(readRobtic(await handMade({ data: { note: FAKE_TOKEN } })), 'secret');
        await expectCode(readRobtic(await handMade({ meta: { name: 'x', createdAt: 'now', description: 'https://discordapp.com/api/v10/webhooks/1/x' } })), 'secret');
    });
});

test('file names keep Arabic and drop symbols', () => {
    expect(robticFileName('Support desk!')).toBe('support-desk.robtic');
    expect(robticFileName('ردود الدعم')).toBe('ردود-الدعم.robtic');
    expect(robticFileName('***')).toBe('robtic-export.robtic');
});

test('the published JSON Schema is valid JSON and agrees with the reader', async () => {
    const schema = JSON.parse(await Bun.file(new URL('../schema/v1.json', import.meta.url)).text());
    const kind = new RegExp(schema.properties.kind.pattern);
    expect(kind.test('discord.bot.system.autoreplies')).toBe(true);
    expect(kind.test('autoreplies')).toBe(false);
    expect(new RegExp(schema.$defs.asset.properties.file.pattern).test(`assets/${'a'.repeat(64)}.png`)).toBe(true);
});
