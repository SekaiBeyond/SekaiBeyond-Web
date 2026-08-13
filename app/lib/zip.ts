/**
 * A minimal ZIP writer: one archive from a list of already-compressed files.
 *
 * Entries are stored, not deflated. The only thing this packs is PNGs, which are
 * deflate streams already — running them through a second pass would cost a
 * compression library for no size win. Nothing here needs Zip64: batches are
 * hundreds of small files, far under the 4 GB / 65 535-entry limits.
 */

export interface ZipEntry {
    /** Path inside the archive. Kept ASCII so no UTF-8 name flag is needed. */
    name: string;
    /** ArrayBuffer-backed, which is what Blob accepts as a BlobPart. */
    data: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** MS-DOS date/time pair, the only timestamp format a base ZIP header carries. */
function dosDateTime(date: Date): {time: number; date: number} {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return {time, date: dosDate};
}

class ByteWriter {
    private readonly chunks: Uint8Array[] = [];
    length = 0;

    push(bytes: Uint8Array): void {
        this.chunks.push(bytes);
        this.length += bytes.length;
    }

    /** Little-endian scalars, which is what every ZIP field is. */
    pushFields(fields: {value: number; size: 2 | 4}[]): void {
        const total = fields.reduce((n, f) => n + f.size, 0);
        const buf = new Uint8Array(total);
        const view = new DataView(buf.buffer);
        let offset = 0;
        for (const f of fields) {
            if (f.size === 2) view.setUint16(offset, f.value & 0xFFFF, true);
            else view.setUint32(offset, f.value >>> 0, true);
            offset += f.size;
        }
        this.push(buf);
    }

    // The ArrayBuffer-backed type (rather than the ArrayBufferLike default) is
    // what Blob accepts as a BlobPart.
    concat(): Uint8Array<ArrayBuffer> {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}

const u2 = (value: number) => ({value, size: 2 as const});
const u4 = (value: number) => ({value, size: 4 as const});

export function buildZip(entries: ZipEntry[], now: Date = new Date()): Blob {
    const {time, date} = dosDateTime(now);
    const body = new ByteWriter();
    const central = new ByteWriter();
    const encoder = new TextEncoder();

    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const crc = crc32(entry.data);
        const offset = body.length;

        // Local file header
        body.pushFields([
            u4(0x04034B50), u2(20), u2(0), u2(0), u2(time), u2(date),
            u4(crc), u4(entry.data.length), u4(entry.data.length),
            u2(name.length), u2(0),
        ]);
        body.push(name);
        body.push(entry.data);

        // Central directory header
        central.pushFields([
            u4(0x02014B50), u2(20), u2(20), u2(0), u2(0), u2(time), u2(date),
            u4(crc), u4(entry.data.length), u4(entry.data.length),
            u2(name.length), u2(0), u2(0), u2(0), u2(0), u4(0), u4(offset),
        ]);
        central.push(name);
    }

    const end = new ByteWriter();
    end.pushFields([
        u4(0x06054B50), u2(0), u2(0), u2(entries.length), u2(entries.length),
        u4(central.length), u4(body.length), u2(0),
    ]);

    return new Blob([body.concat(), central.concat(), end.concat()], {type: 'application/zip'});
}

/** Hand a generated file to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Revoked on the next task so the click has already been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
