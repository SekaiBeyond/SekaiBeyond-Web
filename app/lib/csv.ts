/**
 * `YYYYMMDD-HHMM` in the admin's zone, for export filenames: an export covers
 * whatever is on screen, so the time is what tells two apart.
 */
export const fileStamp = (): string => {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

const csvCell = (value: string): string => {
    // Spreadsheets run a cell starting with = + - or @ as a formula, and some
    // cells hold what people typed in, so those start with an apostrophe.
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CRLF rows, and a BOM so Excel opens it as UTF-8. */
export const buildCsv = (header: string[], rows: string[][]): Blob =>
    new Blob(
        [`﻿${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`],
        {type: 'text/csv;charset=utf-8'},
    );
