export const fileStamp = (): string => {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

const csvCell = (value: string): string => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const buildCsv = (header: string[], rows: string[][]): Blob =>
    new Blob(
        [`﻿${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`],
        {type: 'text/csv;charset=utf-8'},
    );
