import { HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";

export const ALLOWED_UPLOAD_PREFIXES = ["events/", "upcoming-events/", "upcoming-events/headers/", "badges/", "team/", "config/", "passports/", "con/"];
export const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10);
export const MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

/**
 * Videos get their own, larger cap: the con hero loop is a 10-20s clip, which is
 * a few MB even after the encode, where every image on the site is a thumbnail.
 * Well under the 32MiB a Cloud Run request may carry, because the file travels
 * as base64 and so weighs 4/3 its own size on the wire — 20MB of video is a
 * ~27MB request, which leaves room for the JSON around it.
 */
export const MAX_VIDEO_UPLOAD_SIZE_MB = Number(process.env.MAX_VIDEO_UPLOAD_SIZE_MB ?? 20);
export const MAX_VIDEO_UPLOAD_SIZE = MAX_VIDEO_UPLOAD_SIZE_MB * 1024 * 1024;

export function validateStoragePath(path: string): void {
    if (path.includes("..") || path.includes("\0") || path.includes("//")) {
        throw new HttpsError("invalid-argument", "Invalid path characters.");
    }
    if (!ALLOWED_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix))) {
        throw new HttpsError("invalid-argument", "Invalid path.");
    }
}

export const IMAGE_SIGNATURES: {mime: string; magic: Buffer}[] = [
    {mime: "image/jpeg", magic: Buffer.from([0xFF, 0xD8, 0xFF])},
    {mime: "image/png", magic: Buffer.from([0x89, 0x50, 0x4E, 0x47])},
    {mime: "image/gif", magic: Buffer.from([0x47, 0x49, 0x46, 0x38])},
];

/**
 * Only WebM is uploadable, but MP4 is recognised too so that the one file likely
 * to be sent by mistake is named rather than reported as "not a video" — the
 * callers compare this against the content type they were handed.
 *
 * Neither is identified by a magic number at offset 0 the way an image is: an MP4
 * opens with the length of its first box and only then the "ftyp" tag, and a WebM
 * is a Matroska stream whose EBML header says nothing about the codecs inside.
 * This is a container check, not a codec one — enough to know the bytes are not
 * something else wearing a video content type.
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
    // WebP uses a RIFF container — check bytes 0-3 for "RIFF" and bytes 8-11 for "WEBP"
    // to avoid false positives from other RIFF formats (WAV, AVI, etc.)
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
        buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) {
        return "image/webp";
    }
    const match = IMAGE_SIGNATURES.find(sig => buffer.length >= sig.magic.length &&
        buffer.subarray(0, sig.magic.length).equals(sig.magic));
    return match?.mime ?? null;
}

export function extractStoragePath(downloadUrl: string): string | null {
    const match = downloadUrl.match(
        /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/
    );
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

export function logStorageCleanupError(context: string): (err: unknown) => void {
    return (err) => console.error(`Storage cleanup failed (${context}):`, err);
}
