import { byHallOrder, isHallTable } from '~/pages/con/hall';

export interface ImportedVendor {
    table: string;
    name: string;
}

/**
 * A cell that starts with a table code: "A1 Name", "a1: Name", "A-1 — Name", or
 * a bare "A1" with the name in the next cell along. The code has to end at a
 * space, a separator or the end of the cell, so neither "A123" nor a name like
 * "B1rdie" reads as a table.
 */
const CELL = /^([A-Za-z])\s*-?\s*(\d{1,2})(?=$|[\s:：.、\-–—])[\s:：.、\-–—]*(.*)$/s;

const tableIn = (text: string) => {
    const match = CELL.exec(text);
    if (!match) return null;
    const table = `${match[1].toUpperCase()}${Number(match[2])}`;
    return isHallTable(table) ? {table, rest: match[3]} : null;
};

const clean = (cell: unknown) => String(cell ?? '').replace(/\s+/g, ' ').trim();

/**
 * Reads who is at which table out of a sheet's cells, wherever they are laid
 * out: the vendor team's sheet is a grid with one column per row of tables and
 * "A1 Name" in each cell, but a plain two-column table/name list reads the same.
 * Cells that are not about a table on the plan — headers like "A列", notes,
 * blanks — are passed over, and so is a table with no name next to it.
 */
export function parseVendorCells(rows: unknown[][]): ImportedVendor[] {
    const found = new Map<string, string>();
    for (const cells of rows) {
        cells.forEach((cell, i) => {
            const hit = tableIn(clean(cell));
            if (!hit || found.has(hit.table)) return;
            // A bare code takes its name from the next cell, unless that cell is
            // the next table along in a grid where this one was left empty.
            const next = clean(cells[i + 1]);
            const name = clean(hit.rest) || (tableIn(next) ? '' : next);
            if (name) found.set(hit.table, name);
        });
    }
    return [...found]
        .map(([table, name]) => ({table, name}))
        .sort((a, b) => byHallOrder(a.table, b.table));
}

/** The first sheet of an .xlsx or .csv, read in the browser. */
export async function readVendorSheet(file: File): Promise<ImportedVendor[]> {
    const XLSX = await import('xlsx/dist/xlsx.mini.min.js');
    const workbook = XLSX.read(await file.arrayBuffer(), {type: 'array'});
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1, defval: ''}) as unknown[][];
    return parseVendorCells(rows);
}
