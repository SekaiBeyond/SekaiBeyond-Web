import { EMAIL_RE } from './helpers';
import { type AttendeeData, type ParsedRow, type ParseError, TICKET_TYPES, type TicketType } from './types';

const MAX_IMPORT_ROWS = 1000;

/** Folds a type cell so that "Early Bird", "early_bird" and "earlybird" read alike. */
const foldType = (raw: string) => raw.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Every spelling of a type: the stored value, both panel labels, and "comp".
 * Anything else imports as normal.
 */
const TYPE_BY_NAME = new Map<string, TicketType>([
    ...TICKET_TYPES.flatMap(tt =>
        [tt.value, tt.labelEn, tt.labelCn].map(name => [foldType(name), tt.value] as const)),
    ['comp', 'Comp Ticket'],
]);

const parseImportDate = (dStr: string): string | undefined => {
    if (!dStr) return undefined;
    let s = dStr.trim();
    const isoDate = new Date(s);
    if (!isNaN(isoDate.getTime()) && !s.includes('上午') && !s.includes('下午')) {
        return isoDate.toISOString();
    }
    s = s.replace(/-/g, '/');
    let isPM = false;
    let isAM = false;
    if (s.includes('下午')) {
        isPM = true;
        s = s.replace('下午', '').trim();
    } else if (s.includes('上午')) {
        isAM = true;
        s = s.replace('上午', '').trim();
    }
    if (s.match(/pm$/i)) {
        isPM = true;
        s = s.replace(/pm$/i, '').trim();
    }
    if (s.match(/am$/i)) {
        isAM = true;
        s = s.replace(/am$/i, '').trim();
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return undefined;
    if (isPM && d.getHours() < 12) d.setHours(d.getHours() + 12);
    else if (isAM && d.getHours() === 12) d.setHours(0);
    return d.toISOString();
};

export const parseFile = async (file: File) => {
    const XLSX = await import('xlsx/dist/xlsx.mini.min.js');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {type: 'array', cellDates: true});
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
        return {
            fields: [] as string[],
            records: [] as Record<string, string>[],
        };
    }

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

    if (data.length === 0) {
        return {
            fields: [] as string[],
            records: [] as Record<string, string>[],
        };
    }

    const fields = Object.keys(data[0]);
    const records = data.map((row: Record<string, unknown>) => {
        const rec: Record<string, string> = {};
        fields.forEach(field => {
            const v = row[field];
            let str: string;
            if (v == null) {
                str = '';
            } else if (v instanceof Date) {
                str = v.toISOString();
            } else {
                str = String(v);
            }
            rec[field] = str;
        });
        return rec;
    });
    return {fields, records};
};

export interface ColumnMapping {
    email: string;
    name: string;
    count: string;
    type: string;
    timestamp: string;
}

export const validateRows = (
    columns: ColumnMapping,
    records: Record<string, string>[],
    existingAttendees: AttendeeData[] | undefined,
    isEnglish: boolean,
): {rows: ParsedRow[]; errors: ParseError[]} => {
    const {email: emailKey, name: nameKey, count: countKey, type: typeKey, timestamp: timestampKey} = columns;
    const existingEmails = new Map(existingAttendees?.map(a => [a.email.toLowerCase(), {
        name: a.name,
        ticketCount: a.ticketCount,
        type: a.tickets[0]?.type || 'normal',
    }]) || []);
    const parsedRows: ParsedRow[] = [];
    const errs: ParseError[] = [];
    const seen = new Set<string>();

    if (!emailKey) {
        return {
            rows: [],
            errors: [{
                row: 0,
                message: isEnglish
                    ? 'Please select a column for Email.'
                    : '请选择用于邮箱的列。',
            }],
        };
    }

    records.forEach((row, i) => {
        const rowNum = i + 2;
        const email = (row[emailKey] ?? '').trim().toLowerCase();
        const name = nameKey ? (row[nameKey] ?? '').trim() : '';
        const countRaw = countKey ? (row[countKey] ?? '').trim() : '';
        const typeRaw = typeKey ? (row[typeKey] ?? '') : '';
        const timestampRaw = (timestampKey ? (row[timestampKey] ?? '').trim() : '');

        if (!email && !name && !countRaw && !timestampRaw) return;

        if (!EMAIL_RE.test(email)) {
            errs.push({
                row: rowNum,
                message: isEnglish ? `Invalid email: "${email}"` : `邮箱无效："${email}"`,
            });
            return;
        }
        if (name.length > 100) {
            errs.push({
                row: rowNum,
                message: isEnglish ? 'Name exceeds 100 characters.' : '姓名超过 100 字符。',
            });
            return;
        }
        let count = 1;
        if (countRaw) {
            count = parseInt(countRaw, 10);
            if (!Number.isInteger(count) || count < 1 || count > 50) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `ticketCount must be 1–50 (got "${countRaw}").`
                        : `门票数量需为 1–50（当前为"${countRaw}"）。`,
                });
                return;
            }
        }

        const type = TYPE_BY_NAME.get(foldType(typeRaw)) ?? 'normal';

        const timestamp = timestampRaw ? parseImportDate(timestampRaw) : undefined;
        if (timestampRaw && !timestamp) {
            errs.push({
                row: rowNum,
                message: isEnglish ? `Invalid timestamp: "${timestampRaw}"` : `时间戳无效："${timestampRaw}"`,
            });
            return;
        }

        if (seen.has(email)) {
            errs.push({
                row: rowNum,
                message: isEnglish
                    ? `Duplicate email "${email}" — later row will win.`
                    : `邮箱"${email}"重复，将以后一行为准。`,
            });
        }
        seen.add(email);
        const existing = existingEmails.get(email);
        parsedRows.push({
            email,
            name: name || existing?.name || '',
            ticketCount: count,
            type,
            timestamp,
            existingName: existing?.name,
            existingTicketCount: existing?.ticketCount,
            existingType: existing?.type,
            action: existing ? 'skip' : 'add',
        });
    });

    const deduped = new Map<string, ParsedRow>();
    for (const r of parsedRows) deduped.set(r.email, r);

    // Changed existing rows first (they need a decision), then new rows, then
    // unchanged ones.
    const rank = (r: ParsedRow): number => {
        if (r.action === 'add') return 1;
        const hasDiff =
            (r.existingName !== undefined && r.existingName !== r.name) ||
            (r.existingTicketCount !== undefined && r.existingTicketCount !== r.ticketCount) ||
            (r.existingType !== undefined && r.existingType !== r.type);
        return hasDiff ? 0 : 2;
    };
    const finalRows = Array.from(deduped.values()).sort((a, b) => rank(a) - rank(b));

    if (finalRows.length > MAX_IMPORT_ROWS) {
        errs.push({
            row: 0,
            message: isEnglish
                ? `Too many rows (${finalRows.length}). Max ${MAX_IMPORT_ROWS}.`
                : `行数过多（${finalRows.length}）。最多 ${MAX_IMPORT_ROWS}。`,
        });
    }

    return {rows: finalRows, errors: errs};
};
