/** What a .robtic file can hold. `where` is shown when a file is opened on the wrong page. */
export const KINDS = {
    'system.autoreplies': { label: 'Auto replies', where: 'Robtic System → Auto reply' },
    'system.panels': { label: 'Panels', where: 'Robtic System → Panels' },
    'system.automod.template': { label: 'AutoMod template', where: 'Robtic System → AutoMod' },
    'ticket.settings': { label: 'Ticket settings', where: 'Robtic Ticket → Settings' },
    'ticket.panel': { label: 'Ticket panel', where: 'Robtic Ticket → Panels' },
    'ticket.infoPanels': { label: 'Info panels', where: 'Robtic Ticket → Info panels' },
    'staff.ladder': { label: 'Staff ladder', where: 'Robtic Staff' },
    'music.panel': { label: 'Music panel', where: 'Robtic Voice' },
    'bundle': { label: 'Server setup', where: 'Server → Import' },
} as const satisfies Record<string, { label: string; where: string }>;

export type Kind = keyof typeof KINDS;

export const isKind = (k: unknown): k is Kind => typeof k === 'string' && Object.hasOwn(KINDS, k);

/** "This is an AutoMod template. Open it in Robtic System → AutoMod." */
export function wrongPlaceMessage(kind: string): string {
    if (!isKind(kind)) return `This file holds "${kind}", which this version of Robtic doesn't know yet.`;
    const k = KINDS[kind];
    return `This is ${/^[AEIOU]/.test(k.label) ? 'an' : 'a'} ${k.label}. Open it in ${k.where}.`;
}
