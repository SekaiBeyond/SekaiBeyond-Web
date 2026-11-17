export const WALLET_COLORS = ['dark', 'blue', 'green', 'red', 'purple', 'orange'] as const;
type WalletColor = typeof WALLET_COLORS[number];

export const WALLET_PASS_MAX_NOTES = 4;

export const WALLET_PASS_TOP_TEXT = 'Sekai Beyond';

interface WalletPassNote {
    label: string;
    value: string;
}

export interface WalletPassSettings {
    enabled: boolean;
    color: 'auto' | WalletColor;
    headerText: string;
    notes: WalletPassNote[];
}

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

export function walletTicketStyle(type: string): {label: string; shortLabel: string; color: WalletColor} {
    switch (type) {
        case 'early-bird-student':
            return {label: 'Early Bird Student', shortLabel: 'Student EB', color: 'purple'};
        case 'early-bird':
            return {label: 'Early Bird', shortLabel: 'General EB', color: 'blue'};
        case 'student':
            return {label: 'Student', shortLabel: 'Student', color: 'purple'};
        case 'vip':
            return {label: 'VIP', shortLabel: 'VIP', color: 'red'};
        case 'guest':
            return {label: 'Guest', shortLabel: 'Guest', color: 'orange'};
        case 'Comp Ticket':
            return {label: 'Comp Ticket', shortLabel: 'Comp', color: 'dark'};
        case 'vendor':
            return {label: 'Vendor', shortLabel: 'Vendor', color: 'green'};
        default:
            return {label: 'General Admission', shortLabel: 'General', color: 'blue'};
    }
}

export function readWalletPassCount(raw: Record<string, unknown> | undefined): number {
    const n = raw?.passCount;
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
}

export const sameWalletPassSettings = (a: WalletPassSettings, b: WalletPassSettings): boolean =>
    JSON.stringify(parseWalletPassSettings({...a})) === JSON.stringify(parseWalletPassSettings({...b}));
