import { EMAIL_RE } from './helpers';
import type { ParseError, TicketType } from './types';

/**
 * A HomeTown ticket number: its QR holds just these 12 digits, with no event or
 * signature. Ours are UUIDs, so the two never collide. Mirrors
 * functions/src/utils/tickets.ts.
 */
const HOMETOWN_TICKET_RE = /^\d{12}$/;

export const isHometownTicketId = (raw: string): boolean => HOMETOWN_TICKET_RE.test(raw);

/** The attendee doc holding one HomeTown ticket, as importHometownTickets names it. */
export const hometownAttendeeId = (ticketId: string): string => `hometown-${ticketId}`;

/** HomeTown's type names ("Early Bird Student Ticket", "Regular VIP Ticket") as ours. */
export const hometownTicketType = (label: string): TicketType => {
    const s = label.toLowerCase();
    const earlyBird = /early\s*bird/.test(s);
    if (/\bcomp\b|complimentary/.test(s)) return 'Comp Ticket';
    if (s.includes('vip')) return 'vip';
    if (s.includes('student')) return earlyBird ? 'early-bird-student' : 'student';
    return earlyBird ? 'early-bird' : 'normal';
};

export interface HometownTicketRow {
    ticketId: string;
    name: string;
    /** Empty when the export had none, or none that's valid. */
    email: string;
    type: TicketType;
    orderId: string;
}

/** Folds a header so "Ticket/Reserv#" and "ticket reserv" read alike. */
const foldHeader = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The guest list export's headers, folded, for each field read from it. */
const HEADERS = {
    ticketId: ['ticketreserv', 'ticketreservation', 'ticketnumber'],
    firstName: ['firstname'],
    lastName: ['lastname'],
    email: ['email'],
    type: ['tickettype'],
    orderId: ['orderid'],
} as const;

/**
 * Reads HomeTown's guest list export (Export Guest List, a CSV with one row per
 * ticket). A row whose ticket number isn't one is an error and left out; a bad
 * email only drops the email, since the ticket still gets in.
 */
export const parseHometownFile = async (file: File, isEnglish: boolean): Promise<{
    tickets: HometownTicketRow[];
    errors: ParseError[];
    warnings: ParseError[];
}> => {
    const XLSX = await import('xlsx/dist/xlsx.mini.min.js');
    // Raw, so ticket numbers stay as written rather than becoming numbers.
    const workbook = XLSX.read(await file.arrayBuffer(), {type: 'array', raw: true});
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
    const records = sheet
        ? XLSX.utils.sheet_to_json(sheet, {defval: '', raw: true}) as Record<string, unknown>[]
        : [];

    const fields = records.length > 0 ? Object.keys(records[0]) : [];
    const column = (names: readonly string[]) => fields.find(f => names.includes(foldHeader(f))) ?? '';
    const cols = {
        ticketId: column(HEADERS.ticketId),
        firstName: column(HEADERS.firstName),
        lastName: column(HEADERS.lastName),
        email: column(HEADERS.email),
        type: column(HEADERS.type),
        orderId: column(HEADERS.orderId),
    };
    if (!cols.ticketId) {
        return {
            tickets: [],
            errors: [{
                row: 0,
                message: isEnglish
                    ? 'This doesn\'t look like a HomeTown guest list: there\'s no Ticket/Reserv# column.'
                    : '这不像 HomeTown 的来宾名单：缺少 Ticket/Reserv# 列。',
            }],
            warnings: [],
        };
    }

    const cell = (row: Record<string, unknown>, col: string) => col ? String(row[col] ?? '').trim() : '';
    const tickets: HometownTicketRow[] = [];
    const errors: ParseError[] = [];
    const warnings: ParseError[] = [];
    const seen = new Set<string>();

    records.forEach((row, i) => {
        const rowNum = i + 2;
        const ticketId = cell(row, cols.ticketId);
        if (!ticketId && Object.values(row).every(v => String(v ?? '').trim() === '')) return;
        if (!isHometownTicketId(ticketId)) {
            errors.push({
                row: rowNum,
                message: isEnglish
                    ? `Not a HomeTown ticket number: "${ticketId}"`
                    : `不是 HomeTown 门票号："${ticketId}"`,
            });
            return;
        }
        if (seen.has(ticketId)) {
            warnings.push({
                row: rowNum,
                message: isEnglish ? `Ticket ${ticketId} is listed twice.` : `门票 ${ticketId} 重复出现。`,
            });
            return;
        }
        seen.add(ticketId);

        let email = cell(row, cols.email).toLowerCase();
        if (email && !EMAIL_RE.test(email)) {
            warnings.push({
                row: rowNum,
                message: isEnglish
                    ? `Ticket ${ticketId}: invalid email "${email}", imported without one.`
                    : `门票 ${ticketId}：邮箱"${email}"无效，将不带邮箱导入。`,
            });
            email = '';
        }
        tickets.push({
            ticketId,
            name: `${cell(row, cols.firstName)} ${cell(row, cols.lastName)}`.trim().slice(0, 100),
            email,
            type: hometownTicketType(cell(row, cols.type)),
            orderId: cell(row, cols.orderId).slice(0, 32),
        });
    });

    return {tickets, errors, warnings};
};
