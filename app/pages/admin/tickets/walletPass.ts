// An event's wallet pass settings and look, for its Emails section. Mirrors
// functions/src/utils/walletPass.ts and ticketTypeStyle in
// functions/src/utils/ticketEmail.ts.

/** WalletWallet's free colour presets. */
export const WALLET_COLORS = ['dark', 'blue', 'green', 'red', 'purple', 'orange'] as const;
export type WalletColor = typeof WALLET_COLORS[number];

/** Lines an event can add to the back of its passes (WALLET_PASS_MAX_NOTES). */
export const WALLET_PASS_MAX_NOTES = 4;

/** WALLET_PASS_ORGANIZATION's default, shown top-left while the event sets none. */
export const DEFAULT_WALLET_HEADER = 'Sekai Beyond';

export interface WalletPassNote {
    label: string;
    value: string;
}

export interface WalletPassSettings {
    enabled: boolean;
    color: 'auto' | WalletColor;
    headerText: string;
    notes: WalletPassNote[];
}

export const DEFAULT_WALLET_PASS_SETTINGS: WalletPassSettings = {
    enabled: true,
    color: 'auto',
    headerText: '',
    notes: [],
};

/** settings/walletPass as the server reads it (parseWalletPassSettings). */
export function parseWalletPassSettings(raw: Record<string, unknown> | undefined): WalletPassSettings {
    const str = (v: unknown) => typeof v === 'string' ? v.trim() : '';
    const notes: unknown[] = Array.isArray(raw?.notes) ? raw.notes : [];
    return {
        enabled: raw?.enabled !== false,
        color: (WALLET_COLORS as readonly unknown[]).includes(raw?.color) ? raw!.color as WalletColor : 'auto',
        headerText: str(raw?.headerText),
        notes: notes
            .map(n => ({label: str((n as WalletPassNote)?.label), value: str((n as WalletPassNote)?.value)}))
            .filter(n => n.value)
            .slice(0, WALLET_PASS_MAX_NOTES),
    };
}

/**
 * Each preset as WalletWallet draws it, read from the pass.json of passes it
 * made: the background, values and labels.
 */
export const WALLET_COLOR_STYLES: Record<WalletColor, {bg: string; fg: string; label: string}> = {
    dark: {bg: 'rgb(24, 24, 27)', fg: 'rgb(255, 255, 255)', label: 'rgb(161, 161, 170)'},
    blue: {bg: 'rgb(30, 64, 175)', fg: 'rgb(255, 255, 255)', label: 'rgb(191, 219, 254)'},
    green: {bg: 'rgb(21, 128, 61)', fg: 'rgb(255, 255, 255)', label: 'rgb(187, 247, 208)'},
    red: {bg: 'rgb(185, 28, 28)', fg: 'rgb(255, 255, 255)', label: 'rgb(254, 202, 202)'},
    purple: {bg: 'rgb(126, 34, 206)', fg: 'rgb(255, 255, 255)', label: 'rgb(233, 213, 255)'},
    orange: {bg: 'rgb(234, 88, 12)', fg: 'rgb(255, 255, 255)', label: 'rgb(254, 215, 170)'},
};

export const WALLET_COLOR_NAMES: Record<'auto' | WalletColor, {en: string; zh: string}> = {
    auto: {en: 'By ticket type', zh: '按门票类型'},
    dark: {en: 'Dark', zh: '深色'},
    blue: {en: 'Blue', zh: '蓝色'},
    green: {en: 'Green', zh: '绿色'},
    red: {en: 'Red', zh: '红色'},
    purple: {en: 'Purple', zh: '紫色'},
    orange: {en: 'Orange', zh: '橙色'},
};

/** A ticket type's label on the pass and its colour under "auto" (ticketTypeStyle on the server). */
export function walletTicketStyle(type: string): {label: string; color: WalletColor} {
    switch (type) {
        case 'early-bird-student':
            return {label: 'Early Bird Student', color: 'purple'};
        case 'early-bird':
            return {label: 'Early Bird', color: 'blue'};
        case 'student':
            return {label: 'Student', color: 'purple'};
        case 'vip':
            return {label: 'VIP', color: 'red'};
        case 'guest':
            return {label: 'Guest', color: 'orange'};
        case 'Comp Ticket':
            return {label: 'Comp Ticket', color: 'dark'};
        case 'vendor':
            return {label: 'Vendor', color: 'green'};
        default:
            return {label: 'General Admission', color: 'blue'};
    }
}

/** Two settings the same once stored, so an edit undone doesn't read as unsaved. */
export const sameWalletPassSettings = (a: WalletPassSettings, b: WalletPassSettings): boolean =>
    JSON.stringify(parseWalletPassSettings({...a})) === JSON.stringify(parseWalletPassSettings({...b}));
