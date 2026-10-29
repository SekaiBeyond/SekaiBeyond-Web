import { HttpsError } from "firebase-functions/v2/https";
import { getDownloadURL, getStorage } from "firebase-admin/storage";

const ALLOWED_UPLOAD_PREFIXES = ["events/", "upcoming-events/", "badges/", "team/", "config/", "passports/", "con/"];
export const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10);

/**
 * Videos get a larger cap: the hero loop is a few MB where every image is a
 * thumbnail. Well under Cloud Run's 32MiB request limit, since base64 makes 20MB
 * of video a ~27MB request.
 */
export const MAX_VIDEO_UPLOAD_SIZE_MB = Number(process.env.MAX_VIDEO_UPLOAD_SIZE_MB ?? 20);

export function validateStoragePath(path: string): void {
    if (path.includes("..") || path.includes("\0") || path.includes("//")) {
        throw new HttpsError("invalid-argument", "Invalid path characters.");
    }
    if (!ALLOWED_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix))) {
        throw new HttpsError("invalid-argument", "Invalid path.");
    }
}

const IMAGE_SIGNATURES: {mime: string; magic: Buffer}[] = [
    {mime: "image/jpeg", magic: Buffer.from([0xFF, 0xD8, 0xFF])},
    {mime: "image/png", magic: Buffer.from([0x89, 0x50, 0x4E, 0x47])},
    {mime: "image/gif", magic: Buffer.from([0x47, 0x49, 0x46, 0x38])},
];

/**
 * Only WebM is uploadable, but MP4 is recognised too, so the likeliest wrong file
 * is named rather than "not a video".
 *
 * Neither has a magic number at offset 0: an MP4 starts with its first box's
 * length before "ftyp", and a WebM's EBML header says nothing about codecs. A
 * container check, not a codec one.
 */
export function detectVideoMime(buffer: Buffer): string | null {
    if (buffer.length >= 12 && buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) {
        return "video/mp4";
    }
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) {
        return "video/webm";
    }
    return null;
}

export function detectImageMime(buffer: Buffer): string | null {
    // Bytes 0-3 "RIFF" and 8-11 "WEBP", to rule out other RIFF formats (WAV, AVI).
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
        buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) {
        return "image/webp";
    }
    const match = IMAGE_SIGNATURES.find(sig => buffer.length >= sig.magic.length &&
        buffer.subarray(0, sig.magic.length).equals(sig.magic));
    return match?.mime ?? null;
}

/**
 * An upload's base64 bytes, refused unless `contentType` is one of `types`,
 * the file is within `maxMb`, and its bytes are what `contentType` claims.
 */
export function decodeUpload(
    dataBase64: string,
    contentType: string,
    rules: {types: string[]; maxMb: number; kind: "Image" | "Video"; detect: (buffer: Buffer) => string | null},
): Buffer {
    const {types, maxMb, kind, detect} = rules;
    if (!types.includes(contentType)) {
        const allowed = types.length === 1 ? `${types[0]} is` : `${types.slice(0, -1).join(", ")}, or ${types.at(-1)} are`;
        throw new HttpsError("invalid-argument", `Only ${allowed} allowed.`);
    }
    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > maxMb * 1024 * 1024) {
        throw new HttpsError("invalid-argument", `${kind} exceeds ${maxMb}MB limit.`);
    }
    if (detect(buffer) !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }
    return buffer;
}

/** Stores an upload at `path`, cached for a year, and returns its download URL. */
export async function saveUpload(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const file = getStorage().bucket().file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });
    return getDownloadURL(file);
}

// Download URLs are Firebase Storage's, or under the emulators the Storage
// emulator's, which it serves over plain http.
export const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "firebasestorage.googleapis.com";
export const STORAGE_ORIGIN = `${process.env.FIREBASE_STORAGE_EMULATOR_HOST ? "http" : "https"}://${STORAGE_HOST}`;
const STORAGE_PATH_RE = new RegExp(`${STORAGE_HOST.replace(/\./g, "\\.")}/v0/b/[^/]+/o/([^?]+)`);

export function extractStoragePath(downloadUrl: string): string | null {
    const match = downloadUrl.match(STORAGE_PATH_RE);
    if (!match) return null;
    return decodeURIComponent(match[1]);
}

export async function deleteStorageFile(downloadUrl: string, allowedPrefixes?: string[]): Promise<void> {
    const path = extractStoragePath(downloadUrl);
    if (!path) return;
    if (allowedPrefixes && !allowedPrefixes.some(p => path.startsWith(p))) return;
    const file = getStorage().bucket().file(path);
    const [exists] = await file.exists();
    if (exists) await file.delete();
}

/**
 * Refuses a save that links a Storage file that is no longer there.
 *
 * These saves delete files they stop linking, so a form opened before someone
 * else replaced a file would store a dead link and delete the replacement. Only
 * files `alreadyLinked` doesn't name are checked, so an existing dead link
 * doesn't block every save. Compared by path, since re-uploading changes the
 * URL.
 */
export async function requireNewlyLinkedFilesExist(linked: string[], alreadyLinked: string[]): Promise<void> {
    const known = new Set(alreadyLinked.map(extractStoragePath));
    const paths = [...new Set(linked.map(extractStoragePath))]
        .filter((path): path is string => path !== null && !known.has(path));
    const bucket = getStorage().bucket();
    const found = await Promise.all(paths.map(async path => (await bucket.file(path).exists())[0]));
    if (found.includes(false)) {
        throw new HttpsError(
            "failed-precondition",
            "Someone else changed this after you opened it, and a file it links to has since been deleted. " +
            "Reload and make your change again.",
        );
    }
}

export function logStorageCleanupError(context: string): (err: unknown) => void {
    return (err) => console.error(`Storage cleanup failed (${context}):`, err);
}
