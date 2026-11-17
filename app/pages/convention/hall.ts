import type { CSSProperties } from 'react';

export const HALL_ROWS = [
    {letter: 'A', tables: 14},
    {letter: 'B', tables: 14},
    {letter: 'C', tables: 14},
    {letter: 'D', tables: 14},
    {letter: 'E', tables: 3},
] as const;

export type HallRow = typeof HALL_ROWS[number]['letter']

export const HALL_TABLES: string[] = HALL_ROWS.flatMap(({letter, tables}) =>
    Array.from({length: tables}, (_, i) => `${letter}${i + 1}`));

const TABLE_ORDER = new Map(HALL_TABLES.map((table, i) => [table, i]));

export const isHallTable = (table: string) => TABLE_ORDER.has(table);

export const byHallOrder = (a: string, b: string) =>
    (TABLE_ORDER.get(a) ?? Infinity) - (TABLE_ORDER.get(b) ?? Infinity);

export const rowOf = (table: string) => table.charAt(0) as HallRow;

type Track = readonly [landscape: string, portrait: string]

const WALL: Track = ['4px', '4px'];

const COLUMNS: Track[] = [
    WALL,
    ['minmax(52px, 3fr)', '60px'],
    ['10px', '8px'],
    ['minmax(84px, 6fr)', '84px'],
    ['18px', '14px'],
    ...Array.from({length: 28}, (): Track => ['minmax(0, 1fr)', '15px']),
    ['18px', '14px'],
    ['minmax(72px, 4.5fr)', '58px'],
    ['12px', '10px'],
    WALL,
];

const ROWS: Track[] = [
    WALL,
    ['28px', '10px'],
    ['36px', 'minmax(0, 1fr)'],
    ['6px', '4px'],
    ['36px', 'minmax(0, 1fr)'],
    ['44px', '14px'],
    ['36px', 'minmax(0, 1fr)'],
    ['6px', '4px'],
    ['36px', 'minmax(0, 1fr)'],
    ['36px', '12px'],
    ['36px', 'minmax(0, 1fr)'],
    ['8px', '4px'],
    WALL,
];

const ROW_TRACK: Record<HallRow, number> = {A: 2, B: 4, C: 6, D: 8, E: 10};

const E_HALF_COLUMNS = [15, 19, 23];

interface Area {
    col: number
    colSpan: number
    row: number
    rowSpan: number
}

const place = ({col, colSpan, row, rowSpan}: Area): CSSProperties => ({
    '--l-col': `${col + 1} / span ${colSpan}`,
    '--l-row': `${row + 1} / span ${rowSpan}`,
    '--p-col': `${row + 1} / span ${rowSpan}`,
    '--p-row': `${COLUMNS.length - col - colSpan + 1} / span ${colSpan}`,
} as CSSProperties);

export const HALL_GRID_STYLE = {
    '--l-cols': COLUMNS.map(([l]) => l).join(' '),
    '--l-rows': ROWS.map(([l]) => l).join(' '),
    '--p-cols': ROWS.map(([, p]) => p).join(' '),
    '--p-rows': [...COLUMNS].reverse().map(([, p]) => p).join(' '),
} as CSSProperties;

export const HALL_FLOOR = place({col: 0, colSpan: COLUMNS.length, row: 0, rowSpan: ROWS.length});

const tableArea = (table: string): Area => {
    const row = rowOf(table);
    const n = Number(table.slice(1));
    const half = row === 'E' ? E_HALF_COLUMNS[n - 1] : (n - 1) * 2;
    return {col: 5 + half, colSpan: 2, row: ROW_TRACK[row], rowSpan: 1};
};

export const HALL_TABLE_PLACES: {table: string; style: CSSProperties}[] =
    HALL_TABLES.map(table => ({table, style: place(tableArea(table))}));

export type LandmarkKind = 'stage' | 'cheer' | 'booth'

export const HALL_LANDMARKS: {kind: LandmarkKind; style: CSSProperties}[] = [
    {kind: 'stage', style: place({col: 1, colSpan: 1, row: 2, rowSpan: 7})},
    {kind: 'cheer', style: place({col: 3, colSpan: 1, row: 2, rowSpan: 7})},
    {kind: 'booth', style: place({col: 34, colSpan: 1, row: 5, rowSpan: 5})},
];

export const HALL_DOORS: {wall: 'end' | 'side'; style: CSSProperties}[] = [
    {wall: 'end', style: place({col: 0, colSpan: 1, row: 1, rowSpan: 2})},
    {wall: 'end', style: place({col: 0, colSpan: 1, row: 9, rowSpan: 2})},
    {wall: 'side', style: place({col: 1, colSpan: 1, row: ROWS.length - 1, rowSpan: 1})},
    {wall: 'side', style: place({col: 21, colSpan: 3, row: 0, rowSpan: 1})},
    {wall: 'side', style: place({col: 31, colSpan: 3, row: 0, rowSpan: 1})},
    {wall: 'end', style: place({col: COLUMNS.length - 1, colSpan: 1, row: 2, rowSpan: 3})},
];

export const HALL_COMPASS = place({col: 34, colSpan: 1, row: 2, rowSpan: 3});
