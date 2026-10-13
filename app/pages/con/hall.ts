import type { CSSProperties } from 'react';

/**
 * The main hall floor plan the Artist Alley section draws: the HUB Ballroom as
 * laid out for the con, transcribed from HUB's reservation diagram. Like the
 * hero's VENUE_MAP_URL it is fixed to HUB — if the con moves hall, or HUB redraws
 * the tables, this file is what changes. Which vendor sits at each table is admin data
 * (Admin → Con Content → Artist Alley); the tables themselves are not.
 *
 * Only what a visitor walks past is drawn: the stage, the free cheering space,
 * the photo booth, the tables, and the doors the diagram marks as ways in and
 * out. Catering staging, A/V points and keep-clear zones are crew detail.
 *
 * The plan is one CSS grid, set out the way the diagram is drawn: west wall at
 * the top, stage on the left, north on the right. On a narrow screen there is no
 * room for fifteen tables abreast, so the stylesheet turns the same grid a
 * quarter turn anticlockwise — north up, stage at the bottom — instead of
 * squeezing or scrolling it. A rotation and not a transpose: a mirrored plan
 * would put row A on the wrong hand for anyone standing in the hall with it.
 */

export const HALL_ROWS = [
    {letter: 'A', tables: 15},
    {letter: 'B', tables: 15},
    {letter: 'C', tables: 15},
    {letter: 'D', tables: 15},
    {letter: 'E', tables: 3},
] as const;

export type HallRow = typeof HALL_ROWS[number]['letter']

/**
 * Every table on the plan, A1 to E3, in the order the page and the stored list
 * keep them. Mirrored by CON_HALL_TABLES in functions/src/functions/admin.ts,
 * which refuses a table not on this list.
 */
export const HALL_TABLES: string[] = HALL_ROWS.flatMap(({letter, tables}) =>
    Array.from({length: tables}, (_, i) => `${letter}${i + 1}`));

const TABLE_ORDER = new Map(HALL_TABLES.map((table, i) => [table, i]));

export const isHallTable = (table: string) => TABLE_ORDER.has(table);

/** Plan order, so A2 sorts before A10. */
export const byHallOrder = (a: string, b: string) =>
    (TABLE_ORDER.get(a) ?? Infinity) - (TABLE_ORDER.get(b) ?? Infinity);

export const rowOf = (table: string) => table.charAt(0) as HallRow;

/** A track's size as a landscape column or row, then as the portrait row or column it turns into. */
type Track = readonly [landscape: string, portrait: string]

const WALL: Track = ['4px', '4px'];

/**
 * South wall to north wall. Each table is two of the half-table tracks wide, so
 * the E tables, which the diagram puts between the tables above them, still
 * land on a grid line.
 */
const COLUMNS: Track[] = [
    WALL,
    ['minmax(52px, 3fr)', '60px'], // 1: stage
    ['10px', '8px'],
    ['minmax(84px, 6fr)', '84px'], // 3: free cheering space
    ['18px', '14px'],
    ...Array.from({length: 30}, (): Track => ['minmax(0, 1fr)', '15px']), // 5–34: tables 1–15
    ['18px', '14px'],
    ['minmax(72px, 4.5fr)', '58px'], // 36: photo booth
    ['12px', '10px'],
    WALL,
];

/**
 * West wall to east wall. Vendors sit back to back in the narrow gaps between
 * A and B and between C and D, so the wide tracks are the aisles visitors walk.
 */
const ROWS: Track[] = [
    WALL,
    ['28px', '10px'],
    ['36px', 'minmax(0, 1fr)'], // 2: A
    ['6px', '4px'],
    ['36px', 'minmax(0, 1fr)'], // 4: B
    ['44px', '14px'],
    ['36px', 'minmax(0, 1fr)'], // 6: C
    ['6px', '4px'],
    ['36px', 'minmax(0, 1fr)'], // 8: D
    ['36px', '12px'],
    ['36px', 'minmax(0, 1fr)'], // 10: E
    ['8px', '4px'],
    WALL,
];

const ROW_TRACK: Record<HallRow, number> = {A: 2, B: 4, C: 6, D: 8, E: 10};

/** The diagram puts E1–E3 against the east wall, each centred between two tables above. */
const E_HALF_COLUMNS = [15, 19, 23];

/** Zero-based track indices into COLUMNS and ROWS. */
interface Area {
    col: number
    colSpan: number
    row: number
    rowSpan: number
}

/**
 * Grid lines for both orientations, as custom properties the stylesheet picks
 * between in its container query. Turning the plan anticlockwise sends the west
 * wall (the top) to the left and the north wall (the right) to the top, so a
 * landscape row becomes the portrait column of the same index, and landscape
 * column c becomes portrait row `n − c`, counted down from the north wall.
 */
const place = ({col, colSpan, row, rowSpan}: Area): CSSProperties => ({
    '--l-col': `${col + 1} / span ${colSpan}`,
    '--l-row': `${row + 1} / span ${rowSpan}`,
    '--p-col': `${row + 1} / span ${rowSpan}`,
    '--p-row': `${COLUMNS.length - col - colSpan + 1} / span ${colSpan}`,
} as CSSProperties);

/** The track lists for the grid container, landscape and portrait. */
export const HALL_GRID_STYLE = {
    '--l-cols': COLUMNS.map(([l]) => l).join(' '),
    '--l-rows': ROWS.map(([l]) => l).join(' '),
    '--p-cols': ROWS.map(([, p]) => p).join(' '),
    '--p-rows': [...COLUMNS].reverse().map(([, p]) => p).join(' '),
} as CSSProperties;

/** The room itself, walls included — the border is drawn in the wall tracks. */
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
    {kind: 'booth', style: place({col: 36, colSpan: 1, row: 5, rowSpan: 5})},
];

/**
 * The doors the diagram marks with an arrow out: two to the south prefunction,
 * one to the balcony, two up to the second floor and the Mural Lounge, and one
 * to the north prefunction. Each sits in a wall track. `end` is the stage or the
 * north wall, `side` the long west or east wall — the stylesheet needs to know
 * which way the door runs to inset it from the corners.
 */
export const HALL_DOORS: {wall: 'end' | 'side'; style: CSSProperties}[] = [
    {wall: 'end', style: place({col: 0, colSpan: 1, row: 1, rowSpan: 2})},
    {wall: 'end', style: place({col: 0, colSpan: 1, row: 9, rowSpan: 2})},
    {wall: 'side', style: place({col: 1, colSpan: 1, row: ROWS.length - 1, rowSpan: 1})},
    {wall: 'side', style: place({col: 22, colSpan: 3, row: 0, rowSpan: 1})},
    {wall: 'side', style: place({col: 33, colSpan: 3, row: 0, rowSpan: 1})},
    {wall: 'end', style: place({col: COLUMNS.length - 1, colSpan: 1, row: 2, rowSpan: 3})},
];

/** In the free corner beside the north doors, where it reads in either orientation. */
export const HALL_COMPASS = place({col: 36, colSpan: 1, row: 2, rowSpan: 3});
