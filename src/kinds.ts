/**
 * What a .robtic file holds. Kind names always start with the product, so products never clash:
 *
 *   discord.bot.<bot>.<what>     discord.bot.system.autoreplies, discord.bot.ticket.panel
 *   discord.server.<what>        discord.server.bundle (a whole server setup)
 *   hosting.<area>.<type>        hosting.backup.minecraft, hosting.node.config   (future)
 *   account.<what>               account.profile                                 (future)
 *
 * Segments are lowercase words or camelCase (a–z, 0–9). A name, once files exist with it, never changes: a new
 * shape for the same thing bumps kindVersion instead.
 */
export const KINDS = {
    'discord.bot.system.autoreplies': { label: 'Auto replies', what: 'auto replies', where: 'Robtic System → Auto reply' },
    'discord.bot.system.panels': { label: 'Panels', what: 'panels', where: 'Robtic System → Panels' },
    'discord.bot.system.automodTemplate': { label: 'AutoMod template', what: 'an AutoMod template', where: 'Robtic System → AutoMod' },
    'discord.bot.ticket.settings': { label: 'Ticket settings', what: 'ticket settings', where: 'Robtic Ticket → Settings' },
    'discord.bot.ticket.panel': { label: 'Ticket panel', what: 'a ticket panel', where: 'Robtic Ticket → Panels' },
    'discord.bot.ticket.infoPanels': { label: 'Info panels', what: 'info panels', where: 'Robtic Ticket → Info panels' },
    'discord.bot.staff.ladder': { label: 'Staff ladder', what: 'a staff ladder', where: 'Robtic Staff' },
    'discord.bot.voice.musicPanel': { label: 'Music panel', what: 'a music panel', where: 'Robtic Voice' },
    'discord.server.bundle': { label: 'Server setup', what: 'a server setup', where: 'Robtic Discord → Server → Import' },
} as const satisfies Record<string, { label: string; what: string; where: string }>;

export type Kind = keyof typeof KINDS;

/** Products a kind can start with, and where their files are opened. */
export const PRODUCTS = {
    discord: 'Robtic Discord',
    hosting: 'Robtic Hosting',
    account: 'your Robtic account',
} as const;

/** product.segment(.segment…): at least two segments, each a lowercase or camelCase word. */
export const KIND_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

export const isKind = (k: unknown): k is Kind => typeof k === 'string' && Object.hasOwn(KINDS, k);

/**
 * "This file holds an AutoMod template. Open it in Robtic System → AutoMod." For a kind this version doesn't know yet, it
 * still says which product the file belongs to: "This is a Robtic Hosting file. Open it in Robtic Hosting."
 */
export function wrongPlaceMessage(kind: string): string {
    if (isKind(kind)) {
        const k = KINDS[kind];
        return `This file holds ${k.what}. Open it in ${k.where}.`;
    }
    const product = kind.split('.')[0] ?? '';
    if (Object.hasOwn(PRODUCTS, product)) {
        const p = PRODUCTS[product as keyof typeof PRODUCTS];
        return product === 'account' ? `This file belongs to ${p}.` : `This is a ${p} file. Open it in ${p}.`;
    }
    return 'This file was made by a newer version of Robtic. Refresh the page and try again.';
}

