import { functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import { parseSiteTime } from '~/lib/siteTime';
import { EMAIL_RE } from './helpers';
import type { ParseError, TicketType } from './types';

const HOMETOWN_TICKET_RE = /^\d{12}$/;

export const isHometownTicketId = (raw: string): boolean => HOMETOWN_TICKET_RE.test(raw);

export const hometownAttendeeId = (ticketId: string): string => `hometown-${ticketId}`;

const hometownTicketType = (label: string): TicketType => {
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
    email: string;
    type: TicketType;
    orderId: string;
}

const foldHeader = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, '');

const readSheet = async (file: File) => {
    const XLSX = await import('xlsx/dist/xlsx.mini.min.js');
    const workbook = XLSX.read(await file.arrayBuffer(), {type: 'array', raw: true});
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
    const records = sheet
        ? XLSX.utils.sheet_to_json(sheet, {defval: '', raw: true}) as Record<string, unknown>[]
        : [];
    const fields = records.length > 0 ? Object.keys(records[0]) : [];
    const column = (names: readonly string[]) => fields.find(f => names.includes(foldHeader(f))) ?? '';
    return {records, column};
};

const cell = (row: Record<string, unknown>, col: string) => col ? String(row[col] ?? '').trim() : '';

const isBlankRow = (row: Record<string, unknown>) => Object.values(row).every(v => String(v ?? '').trim() === '');

const HEADERS = {
    ticketId: ['ticketreserv', 'ticketreservation', 'ticketnumber'],
    firstName: ['firstname'],
    lastName: ['lastname'],
    email: ['email'],
    type: ['tickettype'],
    orderId: ['orderid'],
} as const;

export const parseHometownFile = async (file: File, isEnglish: boolean): Promise<{
    tickets: HometownTicketRow[];
    errors: ParseError[];
    warnings: ParseError[];
}> => {
    const {records, column} = await readSheet(file);
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

    const tickets: HometownTicketRow[] = [];
    const errors: ParseError[] = [];
    const warnings: ParseError[] = [];
    const seen = new Set<string>();

    records.forEach((row, i) => {
        const rowNum = i + 2;
        const ticketId = cell(row, cols.ticketId);
        if (!ticketId && isBlankRow(row)) return;
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

export interface HometownOrderRow {
    orderId: string;
    orderedAt: string;
}

const ORDER_HEADERS = {
    orderId: ['order', 'ordernumber', 'orderno', 'orderid'],
    time: ['time', 'ordertime', 'orderdate', 'date'],
} as const;

const ZONE_OFFSETS: Record<string, string> = {
    PST: '-08:00', PDT: '-07:00',
    MST: '-07:00', MDT: '-06:00',
    CST: '-06:00', CDT: '-05:00',
    EST: '-05:00', EDT: '-04:00',
    AKST: '-09:00', AKDT: '-08:00',
    HST: '-10:00',
    UTC: 'Z', GMT: 'Z',
};

const ORDER_TIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?(?:\s+([A-Z]{2,4}))?$/i;

const pad = (n: number) => String(n).padStart(2, '0');

const parseHometownOrderTime = (raw: string): string | null => {
    const match = ORDER_TIME_RE.exec(raw.trim());
    if (!match) return null;
    const [, monthRaw, dayRaw, yearRaw, hourRaw, minuteRaw, secondRaw, meridiem, zone] = match;
    const [month, day, year, minute, second] = [monthRaw, dayRaw, yearRaw, minuteRaw, secondRaw ?? '0'].map(Number);
    let hour = Number(hourRaw);
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
        return null;
    }
    const offset = zone ? ZONE_OFFSETS[zone.toUpperCase()] : '';
    if (offset === undefined) return null;
    const date = parseSiteTime(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const parseHometownOrderFile = async (file: File, isEnglish: boolean): Promise<{
    orders: HometownOrderRow[];
    errors: ParseError[];
    warnings: ParseError[];
}> => {
    const {records, column} = await readSheet(file);
    const cols = {orderId: column(ORDER_HEADERS.orderId), time: column(ORDER_HEADERS.time)};
    if (column(HEADERS.ticketId) || !cols.orderId || !cols.time) {
        return {
            orders: [],
            errors: [{
                row: 0,
                message: column(HEADERS.ticketId)
                    ? (isEnglish
                        ? 'This is a HomeTown guest list. Import it under HomeTown tickets, and upload the Order List export here.'
                        : '这是 HomeTown 的来宾名单，请在 HomeTown 门票中导入；此处请上传 Order List 导出文件。')
                    : (isEnglish
                        ? 'This doesn\'t look like a HomeTown order list: it needs an Order # and a Time column.'
                        : '这不像 HomeTown 的订单列表：需要 Order # 和 Time 列。'),
            }],
            warnings: [],
        };
    }

    const orders: HometownOrderRow[] = [];
    const errors: ParseError[] = [];
    const warnings: ParseError[] = [];
    const seen = new Map<string, string>();

    records.forEach((row, i) => {
        const rowNum = i + 2;
        const orderId = cell(row, cols.orderId).slice(0, 32);
        if (!orderId && isBlankRow(row)) return;
        if (!orderId) {
            errors.push({row: rowNum, message: isEnglish ? 'No order number.' : '缺少订单号。'});
            return;
        }
        const timeRaw = cell(row, cols.time);
        const orderedAt = parseHometownOrderTime(timeRaw);
        if (!orderedAt) {
            errors.push({
                row: rowNum,
                message: isEnglish
                    ? `Order ${orderId}: can't read the time "${timeRaw}".`
                    : `订单 ${orderId}：无法识别时间"${timeRaw}"。`,
            });
            return;
        }
        const earlier = seen.get(orderId);
        if (earlier !== undefined) {
            if (earlier !== orderedAt) {
                warnings.push({
                    row: rowNum,
                    message: isEnglish
                        ? `Order ${orderId} is listed twice with different times; the first is kept.`
                        : `订单 ${orderId} 重复出现且时间不同，保留第一条。`,
                });
            }
            return;
        }
        seen.set(orderId, orderedAt);
        orders.push({orderId, orderedAt});
    });

    return {orders, errors, warnings};
};

const RATE_LIMIT_RETRIES = 3;

export const retryRateLimited = async <T>(call: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
        try {
            return await call();
        } catch (err) {
            if (functionsErrorCode(err) !== 'rate-limited' || attempt >= RATE_LIMIT_RETRIES) throw err;
            const ms = functionsErrorDetails<{retryAfterMs?: number}>(err)?.retryAfterMs;
            await new Promise(resolve => setTimeout(resolve, (typeof ms === 'number' ? ms : 10_000) + 1000));
        }
    }
};
