import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, checkRateLimit, normalizeGroup, requireAdmin, requireAuth, } from "../utils/auth";
import { DEFAULT_SENDER_PREFIX, RESEND_QUEUE_CAP, SENDER_DOMAIN } from "../utils/config";
import { db } from "../utils/firebase";
import { EMAIL_PROVIDER, syncProviderUsage } from "../utils/emailProvider";
import { computeEmailQuotaDetail } from "../utils/quota";
import { getSenderAddress, RESEND_API_KEY } from "../utils/resendClient";
import { DRAIN_INTERVAL_MINUTES, getScheduledMailQueueStatus } from "./scheduledMail";
import { recordDoc, recordRef } from "../utils/records";
import {
    deleteStorageFile,
    detectImageMime,
    detectVideoMime,
    extractStoragePath,
    logStorageCleanupError,
    MAX_UPLOAD_SIZE,
    MAX_UPLOAD_SIZE_MB,
    MAX_VIDEO_UPLOAD_SIZE,
    MAX_VIDEO_UPLOAD_SIZE_MB,
    requireNewlyLinkedFilesExist,
    validateStoragePath
} from "../utils/storage";
import {
    sanitizeDisplayText,
    validateCoordinate,
    validateDocId,
    validateEmail,
    validateISODate,
    validateSenderPrefix,
    validateStorageImageUrl,
    validateStr,
    validateUrl
} from "../utils/validation";

export const uploadAdminImage = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const input = request.data as {
        path?: string;
        data?: string;
        contentType?: string;
    };

    const path = input.path;
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!path || !dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing path, data, or contentType.");
    }
    validateStoragePath(path);

    if (contentType !== "image/webp") {
        throw new HttpsError("invalid-argument", "Only image/webp is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", `Image exceeds ${MAX_UPLOAD_SIZE_MB}MB limit.`);
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const downloadUrl = await getDownloadURL(file);
    return {url: downloadUrl};
});

/**
 * The con hero's background loop. Kept apart from `uploadAdminImage` rather than
 * folded into it: the two differ in every check that matters — allowed content
 * types, magic bytes, size cap, and destination prefix. Teaching the image path
 * to carry video would mean every badge and avatar upload inherits the video
 * ceiling as well, which is the one thing that path is careful about.
 */
export const uploadConVideo = onCall({maxInstances: 5, memory: "512MiB"}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const input = request.data as {
        path?: string;
        data?: string;
        contentType?: string;
    };

    const path = input.path;
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!path || !dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing path, data, or contentType.");
    }
    validateStoragePath(path);
    if (!path.startsWith("con/")) {
        throw new HttpsError("invalid-argument", "Con videos must be stored under con/.");
    }

    // WebM alone, because the hero lists one source and it is a WebM. An MP4
    // uploaded here would be stored, named .webm by the caller that minted the
    // path, and then refused by every browser that opened it.
    if (contentType !== "video/webm") {
        throw new HttpsError("invalid-argument", "Only video/webm is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_VIDEO_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", `Video exceeds ${MAX_VIDEO_UPLOAD_SIZE_MB}MB limit.`);
    }

    const detectedMime = detectVideoMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const downloadUrl = await getDownloadURL(file);
    return {url: downloadUrl};
});

export const saveTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const tagId = input.tagId ? validateDocId(input.tagId, "tagId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 100));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const nameLower = name.toLowerCase();
    const docId = tagId ?? db.collection("eventLabels").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (tagId) {
            const existing = await txn.get(db.collection("eventLabels").doc(tagId));
            if (!existing.exists) throw new HttpsError("not-found", "Tag not found.");
        }

        const existingByNameLower = await txn.get(
            db.collection("eventLabels").where("nameLower", "==", nameLower).limit(1),
        );
        if (!existingByNameLower.empty && existingByNameLower.docs[0].id !== tagId) {
            throw new HttpsError("already-exists", "A tag with this name already exists.");
        }

        const ref = db.collection("eventLabels").doc(docId);
        if (tagId) {
            txn.update(ref, {name, nameLower, nameCn});
        } else {
            txn.set(ref, {name, nameLower, nameCn});
        }
        txn.set(recordRef(), recordDoc(tagId ? "tag-edit" : "tag-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: name,
        }));
        return {tagId: docId};
    });
});
export const deleteTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const tagId = validateDocId((request.data as {tagId?: string})?.tagId, "tagId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const tagSnap = await txn.get(db.collection("eventLabels").doc(tagId));
        if (!tagSnap.exists) throw new HttpsError("not-found", "Tag not found.");

        txn.delete(db.collection("eventLabels").doc(tagId));
        txn.set(recordRef(), recordDoc("tag-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: tagSnap.data()?.name ?? tagId,
        }));
        return {deleted: true};
    });
});
export const savePolicy = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const contentEn = validateStr(input.contentEn, "contentEn", 20000);
    const contentCn = validateStr(input.contentCn, "contentCn", 20000);

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("policy").doc("main"), {
            contentEn,
            contentCn,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("policy-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
        }));
        return {saved: true};
    });
});
// picUrl comes from Bilibili's API response (an untrusted third-party field),
// so it must not be used as an arbitrary fetch target — that would be an SSRF
// vector from inside the project. Restrict it to Bilibili's own image CDNs.
function isBilibiliImageUrl(value: string): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        return url.hostname === "hdslb.com"
            || url.hostname.endsWith(".hdslb.com")
            || url.hostname === "biliimg.com"
            || url.hostname.endsWith(".biliimg.com");
    } catch {
        return false;
    }
}

// Con edition posters are config/con-<year>-<stamp>.webp, or config/con-<year>.webp
// from before they were time-stamped. Matched exactly rather than by prefix: the
// con page's guest photos (config/con-guest-*) share the "config/con-" one.
const CON_EDITION_IMAGE_PATH = /^config\/con-\d+[-.]/;

export const saveSiteConfig = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;

    const bvid = input.bilibiliVideoBvid !== undefined
        ? validateStr(input.bilibiliVideoBvid, "bilibiliVideoBvid", 100)
        : undefined;

    if (bvid && !/^BV[a-zA-Z0-9]+$/.test(bvid)) {
        throw new HttpsError("invalid-argument", "Invalid Bilibili BV ID format.");
    }

    // "" clears it, which hides the site's contact links.
    const contactEmail = input.contactEmail === undefined ? undefined
        : input.contactEmail === "" ? ""
            : validateEmail(input.contactEmail, "contactEmail");

    // Only the part before the @ — the domain is always SENDER_DOMAIN, the one
    // Resend accepts. "" clears it, which sends from DEFAULT_SENDER_PREFIX.
    const senderPrefix = input.senderPrefix === undefined ? undefined
        : input.senderPrefix === "" ? ""
            : validateSenderPrefix(input.senderPrefix, "senderPrefix");

    const conEditionRaw = input.conEdition;
    let conEdition: any | undefined = undefined;
    if (conEditionRaw === null) {
        conEdition = null;
    } else if (conEditionRaw !== undefined) {
        const ed = conEditionRaw as Record<string, any>;
        conEdition = {
            year: Number(ed.year),
            date: validateISODate(ed.date, "date") || "",
            location: validateStr(ed.location, "location", 200, true),
            locationCn: validateStr(ed.locationCn, "locationCn", 200),
            description: validateStr(ed.description, "description", 2000, true),
            descriptionCn: validateStr(ed.descriptionCn, "descriptionCn", 2000, true),
            image: validateStr(ed.image, "image", 500, true),
            highlights: Array.isArray(ed.highlights) ? ed.highlights.map((h: any) => ({
                labelEn: validateStr(h.labelEn, "highlight labelEn", 100, true),
                labelCn: validateStr(h.labelCn, "highlight labelCn", 100, true),
                icon: validateStr(h.icon, "highlight icon", 50, true),
            })) : [],
        };
        validateStorageImageUrl(conEdition.image, "convention image");
    }

    // Gate the network + storage side effects behind an admin check BEFORE
    // running them. adminTransaction below is the authoritative (transactional)
    // gate for the Firestore write, but the Bilibili fetch and the
    // config/video-cover storage write happen out here — without this, any
    // signed-in user could trigger a server-side fetch and overwrite the
    // public cover object.
    await requireAdmin(uid);

    let coverUrl = '';
    if (bvid) {
        try {
            const apiResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                headers: {'User-Agent': 'Mozilla/5.0'},
                signal: AbortSignal.timeout(5000),
            });
            if (apiResp.ok) {
                const json = await apiResp.json() as {code: number; data?: {pic?: string}};
                const pic = json?.data?.pic ?? '';
                const picUrl = pic.startsWith('http:') ? 'https:' + pic.slice(5) : pic;
                if (picUrl && isBilibiliImageUrl(picUrl)) {
                    const imgResp = await fetch(picUrl, {
                        headers: {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'},
                        signal: AbortSignal.timeout(10000),
                    });
                    if (imgResp.ok) {
                        const buffer = Buffer.from(await imgResp.arrayBuffer());
                        // Trust the bytes, not the response's content-type header:
                        // verify the payload really is an image and is within the
                        // upload size cap before storing it in the public bucket.
                        const detectedMime = detectImageMime(buffer);
                        if (detectedMime && buffer.length <= MAX_UPLOAD_SIZE) {
                            const bucket = getStorage().bucket();
                            const file = bucket.file('config/video-cover');
                            await file.save(buffer, {
                                metadata: {
                                    contentType: detectedMime,
                                    cacheControl: 'public, max-age=31536000, immutable'
                                },
                            });
                            const baseCoverUrl = await getDownloadURL(file);
                            coverUrl = `${baseCoverUrl}&t=${Date.now()}`;
                        }
                    }
                }
            }
        } catch {
            // Cover fetch is best-effort; proceed without it
        }
    }

    const configRef = db.collection("config").doc("main");
    const oldConImage = await adminTransaction(uid, async (txn, callerSnap) => {
        // Read before the writes, as transactions require. Only a save that carries
        // the con edition can replace or clear its image.
        const prevConImage: string = conEdition !== undefined
            ? (await txn.get(configRef)).data()?.conEdition?.image ?? ""
            : "";
        if (conEdition) await requireNewlyLinkedFilesExist([conEdition.image], [prevConImage]);

        const updateData: Record<string, any> = {
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        };
        // Each Site Config section saves on its own; the record names which.
        const configSections: string[] = [];
        if (bvid !== undefined) {
            updateData.bilibiliVideoBvid = bvid;
            updateData.bilibiliVideoCoverUrl = coverUrl;
            configSections.push("video");
        }
        if (contactEmail !== undefined) {
            updateData.contactEmail = contactEmail;
            configSections.push("contact");
        }
        if (senderPrefix !== undefined) {
            updateData.senderPrefix = senderPrefix;
            configSections.push("sender");
        }
        if (conEdition !== undefined) {
            updateData.conEdition = conEdition;
            configSections.push("con-edition");
        }

        txn.set(configRef, updateData, {merge: true});
        txn.set(recordRef(), recordDoc("config-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            configSections,
        }));
        return prevConImage;
    });

    // Each upload writes a new time-stamped object, so the image this save
    // replaces — or a reset drops — is left behind unless deleted here. Compared
    // by path rather than URL: a client from before uploads were time-stamped
    // overwrites config/con-<year>.webp in place, which can give the same object
    // a new URL.
    const oldConImagePath = extractStoragePath(oldConImage);
    if (oldConImagePath
        && oldConImagePath !== extractStoragePath(conEdition?.image ?? "")
        && CON_EDITION_IMAGE_PATH.test(oldConImagePath)) {
        await deleteStorageFile(oldConImage)
            .catch(logStorageCleanupError("saveSiteConfig con edition"));
    }

    return {saved: true};
});

// Mirrors ROOM_ACCENTS in app/pages/con/content.ts. Each value names a CSS class
// (sbc-accent--<accent>), so the palette is a whitelist even though the rooms
// that use it are free-form, admin-managed data.
const CON_ROOM_ACCENTS = ["pink", "violet", "amber", "sky", "mint", "slate"] as const;

const CON_SECTIONS = [
    "settings", "event", "heroVideo", "rooms", "schedule", "guests", "vendors", "tickets", "ticketFee",
    "inPersonSales", "faq",
] as const;
type ConSection = typeof CON_SECTIONS[number];

// Mirrors HIDEABLE_SECTIONS in app/pages/con/content.ts. Each is a key of
// CON_SECTIONS as well as an anchor on the page.
const CON_HIDEABLE_SECTIONS = ["guests", "vendors"] as const satisfies readonly ConSection[];

// Caps on how much copy one section can hold. Generous against real use, tight
// enough that a runaway client cannot grow the public document without bound.
const CON_LIMITS = {
    rooms: 24,
    scheduleItems: 120,
    guests: 60,
    vendors: 120,
    tickets: 8,
    perks: 12,
    inPersonSessions: 30,
    faq: 40,
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface LocalizedText {
    en: string;
    zh: string;
}

/**
 * Con copy is stored as {en, zh} pairs rather than the `field`/`fieldCn` columns
 * the rest of the admin data uses, because the con page reads it that way.
 */
function validateLocalized(raw: unknown, name: string, maxLen: number, required = false): LocalizedText {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
        en: sanitizeDisplayText(validateStr(value.en, `${name} (English)`, maxLen, required)),
        zh: sanitizeDisplayText(validateStr(value.zh, `${name} (Chinese)`, maxLen, required)),
    };
}

function validateConArray(raw: unknown, name: string, maxItems: number): Record<string, unknown>[] {
    if (!Array.isArray(raw)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be an array.`);
    }
    if (raw.length > maxItems) {
        throw new HttpsError("invalid-argument", `${name} has too many items (max ${maxItems}).`);
    }
    return raw.map(item => (item && typeof item === "object" ? item as Record<string, unknown> : {}));
}

function validateConTime(raw: unknown, name: string): string {
    const value = validateStr(raw, name, 5, true);
    if (!HHMM_RE.test(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be HH:MM.`);
    }
    return value;
}

function requireISODate(raw: unknown, name: string): string {
    const value = validateISODate(raw, name);
    if (!value) throw new HttpsError("invalid-argument", `${name} is required.`);
    return value;
}

/**
 * Con assets — guest photos and the hero clip — come from two places:
 * an admin upload (a Storage download URL) or a file committed under public/ (a
 * root-relative path). Anything else — an off-site URL, a traversal attempt — is
 * rejected, so nothing the page loads is served from a host we do not control.
 */
function validateConAsset(raw: unknown, name: string): string {
    const value = validateStr(raw, name, 500).trim();
    if (!value) return "";
    if (value.startsWith("/")) {
        if (value.startsWith("//") || value.includes("..") || !/^\/[\w\-./]+$/.test(value)) {
            throw new HttpsError("invalid-argument", `Invalid ${name}.`);
        }
        return value;
    }
    validateStorageImageUrl(value, name);
    return value;
}

function validateConLink(raw: unknown, name: string): string {
    const value = validateStr(raw, name, 500).trim();
    validateUrl(value, name);
    return value;
}

/**
 * Page-level switches. `published: false` takes /con off the public web, so it is
 * stored as a strict boolean rather than anything truthy — a stray string here
 * would silently republish the page.
 *
 * `hiddenSections` is optional so a client from before it existed can still save;
 * leaving it out shows every section.
 */
function buildConSettings(raw: unknown) {
    const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (typeof s.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be true or false.");
    }
    const hidden = s.hiddenSections ?? [];
    const hideable: readonly unknown[] = CON_HIDEABLE_SECTIONS;
    if (!Array.isArray(hidden) || hidden.some(section => !hideable.includes(section))) {
        throw new HttpsError("invalid-argument", `hiddenSections may only list ${CON_HIDEABLE_SECTIONS.join(", ")}.`);
    }
    return {
        published: s.published,
        // Canonical order, matching what the editor compares its draft against.
        hiddenSections: CON_HIDEABLE_SECTIONS.filter(section => hidden.includes(section)),
    };
}

function buildConEvent(raw: unknown) {
    const e = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const edition = Number(e.edition);
    if (!Number.isInteger(edition) || edition < 2000 || edition > 2200) {
        throw new HttpsError("invalid-argument", "Invalid edition year.");
    }

    const date = requireISODate(e.date, "date");
    const endTime = requireISODate(e.endTime, "endTime");
    if (Date.parse(endTime) <= Date.parse(date)) {
        throw new HttpsError("invalid-argument", "End time must be after the start time.");
    }

    const ticketUrl = validateConLink(e.ticketUrl, "ticketUrl");
    if (!ticketUrl) throw new HttpsError("invalid-argument", "ticketUrl is required.");

    // That the venue exists is checked inside saveConContent's transaction.
    if (!e.venueId) throw new HttpsError("invalid-argument", "Select a venue.");
    const venueId = validateDocId(e.venueId, "venueId");

    return {
        edition,
        tagline: validateLocalized(e.tagline, "tagline", 300),
        intro: validateLocalized(e.intro, "intro", 2000),
        date,
        endTime,
        venueId,
        ticketUrl,
    };
}

/**
 * The hero's background loop. Optional: with no clip the hero shows a gradient.
 *
 * The extension is pinned to the container the source element claims. A .webm url
 * holding something else is not a security problem, but it is an invisible one —
 * a browser that cannot decode what it finds drops the source silently, and the
 * hero would sit on the gradient with nothing to say why.
 */
function buildConHeroVideo(raw: unknown) {
    const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const webm = validateConAsset(v.webm, "hero webm");
    if (webm && !/\.webm(\?|$)/i.test(webm)) {
        throw new HttpsError("invalid-argument", "The clip must be a .webm file.");
    }
    return {webm};
}

/**
 * Ids for rows the admin never sees or types (ticket tiers).
 * The fallback is index-derived, which collides on its own: deleting `tier-2` from
 * [tier-1, tier-2, tier-3] and adding a row hands the new one index 2, i.e. the
 * `tier-3` that already exists. Renaming rather than rejecting is deliberate — the
 * editor exposes no id field, so a rejected duplicate would be unfixable, and these
 * ids are not referenced from anywhere else the way room ids are.
 */
function uniqueConId(raw: unknown, fallback: string, seen: Set<string>, name: string): string {
    let id = sanitizeDisplayText(validateStr(raw, name, 60)) || fallback;
    if (seen.has(id)) {
        let n = 2;
        while (seen.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
    }
    seen.add(id);
    return id;
}

/** Room ids are referenced by schedule items, so they must be slug-shaped and unique. */
function buildConRooms(raw: unknown) {
    const seen = new Set<string>();
    return validateConArray(raw, "rooms", CON_LIMITS.rooms).map((room, i) => {
        const id = sanitizeDisplayText(validateStr(room.id, "room id", 60)) || `room-${i + 1}`;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
            throw new HttpsError(
                "invalid-argument",
                `Invalid room id "${id}": use lowercase letters, numbers, and hyphens.`,
            );
        }
        if (seen.has(id)) {
            throw new HttpsError("invalid-argument", `Duplicate room id "${id}".`);
        }
        seen.add(id);

        const accent = typeof room.accent === "string" && (CON_ROOM_ACCENTS as readonly string[]).includes(room.accent)
            ? room.accent
            : null;
        if (!accent) {
            throw new HttpsError("invalid-argument", `room accent must be one of ${CON_ROOM_ACCENTS.join(", ")}.`);
        }

        return {id, name: validateLocalized(room.name, "room name", 120, true), accent};
    });
}

function buildConSchedule(raw: unknown) {
    return validateConArray(raw, "schedule", CON_LIMITS.scheduleItems).map(item => {
        // A slot can be announced before it is scheduled. Both times absent
        // means TBA; exactly one is a half-filled form, not an intent.
        const hasStart = item.start !== undefined && item.start !== null && item.start !== "";
        const hasEnd = item.end !== undefined && item.end !== null && item.end !== "";
        if (hasStart !== hasEnd) {
            throw new HttpsError(
                "invalid-argument",
                "An item needs both a start and an end time, or neither (TBA).",
            );
        }
        const times = hasStart
            ? {start: validateConTime(item.start, "item start"), end: validateConTime(item.end, "item end")}
            : {};
        // HH:MM sorts chronologically, so this is a plain string compare. It also
        // means an item that runs past midnight cannot be expressed — acceptable
        // for a single-day con, and the alternative is silently accepting the far
        // more common "17:30–15:30" typo.
        if (times.start && times.end && times.end <= times.start) {
            throw new HttpsError(
                "invalid-argument",
                `A schedule item ends at ${times.end}, which is not after its ${times.start} start.`,
            );
        }

        // Required of a scheduled item, which has to be drawn in some column, and
        // dropped from a TBA one: a con books the hour and the room together, so a
        // slot still waiting on the hour has no room to name yet. Stored only when
        // there is one, like detail below.
        const room = hasStart
            ? sanitizeDisplayText(validateStr(item.room, "item room", 60, true))
            : "";

        const detail = validateLocalized(item.detail, "item detail", 1000);
        return {
            ...times,
            ...(room ? {room} : {}),
            title: validateLocalized(item.title, "item title", 200, true),
            // Stored only when written, so the page's `item.detail &&` check
            // keeps meaning "there is a detail line" rather than "the key exists".
            ...(detail.en || detail.zh ? {detail} : {}),
        };
    })
        // Stored in start order, so the editor has no reorder buttons to keep in
        // step. An item with no time yet has nowhere on the clock to go, so it
        // sorts last rather than to the top on an empty string.
        .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
}

function buildConGuests(raw: unknown) {
    return validateConArray(raw, "guests", CON_LIMITS.guests).map(guest => ({
        name: sanitizeDisplayText(validateStr(guest.name, "guest name", 120, true)),
        role: validateLocalized(guest.role, "guest role", 120),
        blurb: validateLocalized(guest.blurb, "guest blurb", 1000),
        avatar: validateConAsset(guest.avatar, "guest avatar"),
        link: validateConLink(guest.link, "guest link"),
    }));
}

function buildConVendors(raw: unknown) {
    const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const cta = v.cta && typeof v.cta === "object" ? v.cta as Record<string, unknown> : {};
    return {
        list: validateConArray(v.list, "vendors", CON_LIMITS.vendors).map(vendor => ({
            name: sanitizeDisplayText(validateStr(vendor.name, "vendor name", 120, true)),
            kind: validateLocalized(vendor.kind, "vendor kind", 120),
            handle: sanitizeDisplayText(validateStr(vendor.handle, "vendor handle", 120)),
            link: validateConLink(vendor.link, "vendor link"),
        })),
        cta: {
            heading: validateLocalized(cta.heading, "vendor CTA heading", 200),
            body: validateLocalized(cta.body, "vendor CTA body", 1000),
            label: validateLocalized(cta.label, "vendor CTA label", 120),
        },
    };
}

/** A ticket price in US dollars. Stray fractions of a cent are rounded off. */
function validateConPrice(raw: unknown, name: string): number {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 10000) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a dollar amount from 0 to 10000.`);
    }
    return Math.round(raw * 100) / 100;
}

function buildConTickets(raw: unknown) {
    const seen = new Set<string>();
    return validateConArray(raw, "tickets", CON_LIMITS.tickets).map((tier, i) => {
        const name = validateLocalized(tier.name, "tier name", 120, true);

        // The page tells visitors what the tier costs once the early bird ends,
        // so an early bird is all-or-nothing: its own price and a deadline. A
        // half-filled one is a form mistake.
        const hasEarlyBird = tier.earlyBird !== undefined && tier.earlyBird !== null;
        const price = validateConPrice(tier.price, `${name.en} price`);
        let earlyBird: {price: number; endsAt: string} | undefined;
        if (hasEarlyBird) {
            const e = typeof tier.earlyBird === "object" ? tier.earlyBird as Record<string, unknown> : {};
            earlyBird = {
                price: validateConPrice(e.price, `${name.en} early bird price`),
                endsAt: requireISODate(e.endsAt, `${name.en} early bird end`),
            };
            // "Early bird $10, then $10" is not an offer.
            if (earlyBird.price >= price) {
                throw new HttpsError(
                    "invalid-argument",
                    `${name.en} early bird price must be lower than the regular price.`,
                );
            }
        }

        return {
            id: uniqueConId(tier.id, `tier-${i + 1}`, seen, "tier id"),
            name,
            price,
            ...(earlyBird ? {earlyBird} : {}),
            note: validateLocalized(tier.note, "tier note", 300),
            perks: validateConArray(tier.perks, "tier perks", CON_LIMITS.perks)
                .map(perk => validateLocalized(perk, "perk", 200))
                .filter(perk => perk.en || perk.zh),
            featured: tier.featured === true,
        };
    });
}

function buildConTicketFee(raw: unknown) {
    const f = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const percent = f.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new HttpsError("invalid-argument", "Invalid fee percent: must be from 0 to 100.");
    }
    return {
        percent: Math.round(percent * 100) / 100,
        flat: validateConPrice(f.flat, "flat fee"),
    };
}

/** A real calendar day as YYYY-MM-DD — Date.parse alone lets "2026-02-31" through as March 3. */
function validateConDay(raw: unknown, name: string): string {
    const value = validateStr(raw, name, 10, true);
    const ms = Date.parse(`${value}T00:00:00Z`);
    // toISOString throws on an invalid date, hence the NaN check first.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a date.`);
    }
    return value;
}

function buildConInPersonSales(raw: unknown) {
    const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sessions = validateConArray(s.sessions, "in-person sessions", CON_LIMITS.inPersonSessions)
        .map(session => {
            const date = validateConDay(session.date, "in-person sale date");
            const start = validateConTime(session.start, `${date} start`);
            const end = validateConTime(session.end, `${date} end`);
            // HH:MM sorts chronologically, as in buildConSchedule.
            if (end <= start) {
                throw new HttpsError("invalid-argument", `The ${date} in-person sale ends before it starts.`);
            }
            return {date, start, end};
        })
        // Stored in date order, so the editor has no reorder buttons to keep in step.
        .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));

    return {
        // Only needed while there is somewhere to send people.
        location: validateLocalized(s.location, "in-person sale location", 200, sessions.length > 0),
        note: validateLocalized(s.note, "in-person sale note", 500),
        sessions,
    };
}

function buildConFaq(raw: unknown) {
    return validateConArray(raw, "faq", CON_LIMITS.faq).map(entry => ({
        q: validateLocalized(entry.q, "question", 300, true),
        a: validateLocalized(entry.a, "answer", 2000),
    }));
}

const CON_SECTION_BUILDERS: Record<ConSection, (raw: unknown) => unknown> = {
    settings: buildConSettings,
    event: buildConEvent,
    heroVideo: buildConHeroVideo,
    rooms: buildConRooms,
    schedule: buildConSchedule,
    guests: buildConGuests,
    vendors: buildConVendors,
    tickets: buildConTickets,
    ticketFee: buildConTicketFee,
    inPersonSales: buildConInPersonSales,
    faq: buildConFaq,
};

/** Where the con editor uploads to: the hero clip, and the guests' photos. */
const CON_ASSET_PREFIXES = ["con/", "config/con-guest-"];

/** Every file URL con content points at. Root-relative public/ paths come along
 *  too; deleteStorageFile passes over anything that is not a Storage URL. */
function conAssetUrls(content: Record<string, any>): string[] {
    const guests: any[] = Array.isArray(content.guests) ? content.guests : [];
    return [content.heroVideo?.webm, ...guests.map(guest => guest?.avatar)]
        .filter((url): url is string => typeof url === "string" && url !== "");
}

/**
 * Writes one or more sections of the /con page.
 *
 * Saves are per section on purpose: the editor has one Save button per section,
 * and a merge write of only the named sections means two people editing
 * different parts of the page cannot overwrite each other's work.
 *
 * Everything lands in the staff-only `conContent/draft`. `conContent/main` is a
 * whole-document mirror of it, created when the con is published and deleted when
 * it is not — so an unannounced line-up is genuinely not on the public web, rather
 * than sitting in a world-readable document behind a flag the page is trusted to
 * respect. The two documents' read rules are in firestore.rules.
 */
export const saveConContent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const sections = CON_SECTIONS.filter(section => input[section] !== undefined);
    if (sections.length === 0) {
        throw new HttpsError("invalid-argument", "No con content sections provided.");
    }

    const updateData: Record<string, any> = {};
    for (const section of sections) {
        updateData[section] = CON_SECTION_BUILDERS[section](input[section]);
    }

    const orphanedAssets = await adminTransaction(uid, async (txn, callerSnap) => {
        const draftRef = db.collection("conContent").doc("draft");
        const publicRef = db.collection("conContent").doc("main");

        const stored = (await txn.get(draftRef)).data() ?? {};
        await requireNewlyLinkedFilesExist(conAssetUrls(updateData), conAssetUrls(stored));

        if (updateData.event !== undefined) {
            const venueSnap = await txn.get(db.collection("venues").doc(updateData.event.venueId));
            if (!venueSnap.exists) {
                throw new HttpsError("failed-precondition", "The selected venue no longer exists. Pick another.");
            }
        }

        // Rooms and the schedule that references them can be saved separately, so
        // the pairing is only coherent once both sides are known. Check the result
        // of this write against whichever side it is not carrying — that catches
        // both "item points at a room that never existed" and "room deleted while
        // the schedule still uses it".
        if (updateData.rooms !== undefined || updateData.schedule !== undefined) {
            const rooms = updateData.rooms ?? stored.rooms;
            // Rooms never saved means the page is still on the code defaults, which
            // the server cannot see — nothing to check against yet.
            if (rooms !== undefined) {
                const schedule = (updateData.schedule ?? stored.schedule ?? []) as {room?: string}[];
                const ids = new Set((rooms as {id?: string}[]).map(r => r?.id));
                const missing = [...new Set(
                    schedule.map(item => item?.room ?? "").filter(room => room && !ids.has(room)),
                )];
                if (missing.length > 0) {
                    throw new HttpsError(
                        "failed-precondition",
                        `The schedule still uses ${missing.length === 1 ? "a room" : "rooms"} that would not exist: ` +
                        `${missing.join(", ")}. Reassign those items first.`,
                    );
                }
            }
        }

        txn.set(draftRef, {
            ...updateData,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});

        // The public document is a mirror of the draft that exists only while the
        // con is published, so hiding the page removes the copy rather than leaving
        // it world-readable behind a client-side flag. Written whole, not merged, so
        // a section deleted in the draft cannot survive in the mirror. `updatedBy`
        // is deliberately left out — nothing about who edits belongs on a public doc.
        // A hidden section's copy stays out of it for the same reason the whole
        // mirror does while unpublished: hiding a line-up should not leave it
        // readable to anyone who asks the database directly.
        const merged = {...stored, ...updateData};
        const settings = merged.settings as {published?: boolean; hiddenSections?: string[]} | undefined;
        const published = settings?.published === true;
        if (published) {
            const hidden = new Set<string>(settings?.hiddenSections ?? []);
            const mirror: Record<string, any> = {updatedAt: FieldValue.serverTimestamp()};
            for (const section of CON_SECTIONS) {
                if (merged[section] !== undefined && !hidden.has(section)) mirror[section] = merged[section];
            }
            txn.set(publicRef, mirror);
        } else {
            txn.delete(publicRef);
        }

        txn.set(recordRef(), recordDoc("con-content-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            conSection: sections.join(", "),
        }));

        // Each upload writes a new time-stamped object, so a clip or photo this
        // save replaces — or a removed guest's photo — is left behind and deleted
        // once the save commits. Both documents now name the clip and photos that
        // `merged` does, so one it no longer names is referenced by neither.
        const stillReferenced = new Set(conAssetUrls(merged));
        return [...new Set(conAssetUrls(stored))].filter(url => !stillReferenced.has(url));
    });

    for (const url of orphanedAssets) {
        await deleteStorageFile(url, CON_ASSET_PREFIXES)
            .catch(logStorageCleanupError(`saveConContent ${url}`));
    }

    return {saved: true};
});

const PARKING_LOT_TYPES = ["general", "disabled", "garage"] as const;

export const saveParkingLot = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const lotId = input.lotId ? validateDocId(input.lotId, "lotId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 200, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 200));
    const type = typeof input.type === "string" && (PARKING_LOT_TYPES as readonly string[]).includes(input.type)
        ? input.type as typeof PARKING_LOT_TYPES[number]
        : null;
    if (!type) throw new HttpsError("invalid-argument", `type must be one of ${PARKING_LOT_TYPES.join(", ")}.`);
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);
    // rateId links to a parkingRates tier; "" means no rate assigned.
    const rateId = typeof input.rateId === "string" && input.rateId.trim()
        ? validateDocId(input.rateId, "rateId")
        : "";

    const docId = lotId ?? db.collection("parkingLots").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (lotId) {
            const existing = await txn.get(db.collection("parkingLots").doc(lotId));
            if (!existing.exists) throw new HttpsError("not-found", "Parking lot not found.");
        }
        if (rateId) {
            const rateSnap = await txn.get(db.collection("parkingRates").doc(rateId));
            if (!rateSnap.exists) throw new HttpsError("not-found", "Parking rate not found.");
        }

        const ref = db.collection("parkingLots").doc(docId);
        const data = {name, nameCn, type, lat, lng, rateId};
        if (lotId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(recordRef(), recordDoc(lotId ? "parkinglot-edit" : "parkinglot-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            lotId: docId,
            lotName: name,
        }));
        return {lotId: docId};
    });
});
export const deleteParkingLot = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const lotId = validateDocId((request.data as {lotId?: string})?.lotId, "lotId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const lotSnap = await txn.get(db.collection("parkingLots").doc(lotId));
        if (!lotSnap.exists) throw new HttpsError("not-found", "Parking lot not found.");

        // Cascade unlink: remove this lotId from every venue that references it.
        const venuesSnap = await txn.get(db.collection("venues"));
        let unlinkedFrom = 0;
        for (const doc of venuesSnap.docs) {
            const lots = Array.isArray(doc.data().parkingLots) ? doc.data().parkingLots : [];
            const filtered = lots.filter((l: any) => l?.lotId !== lotId);
            if (filtered.length !== lots.length) {
                txn.update(doc.ref, {parkingLots: filtered});
                unlinkedFrom++;
            }
        }

        txn.delete(db.collection("parkingLots").doc(lotId));
        txn.set(recordRef(), recordDoc("parkinglot-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            lotName: lotSnap.data()?.name ?? lotId,
            unlinkedFrom,
        }));
        return {deleted: true, unlinkedFrom};
    });
});

export const saveParkingRate = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const rateId = input.rateId ? validateDocId(input.rateId, "rateId") : null;
    const labelEn = sanitizeDisplayText(validateStr(input.labelEn, "labelEn", 200, true));
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 200));
    if (!labelEn) throw new HttpsError("invalid-argument", "labelEn is required.");
    // Marker color for lots on this tier; "" defers to the client-side preset fallback.
    const color = typeof input.color === "string" ? input.color.trim().toLowerCase() : "";
    if (color && !/^#[0-9a-f]{6}$/.test(color)) {
        throw new HttpsError("invalid-argument", "color must be a hex color like #4b2e83.");
    }

    const docId = rateId ?? db.collection("parkingRates").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (rateId) {
            const existing = await txn.get(db.collection("parkingRates").doc(rateId));
            if (!existing.exists) throw new HttpsError("not-found", "Parking rate not found.");
        }

        const ref = db.collection("parkingRates").doc(docId);
        if (rateId) {
            // Preserve the existing display order on edit; only labels and color change.
            txn.update(ref, {labelEn, labelCn, color});
        } else {
            txn.set(ref, {labelEn, labelCn, color, order: Date.now()});
        }
        txn.set(recordRef(), recordDoc(rateId ? "parkingrate-edit" : "parkingrate-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            rateId: docId,
            rateLabel: labelEn,
        }));
        return {rateId: docId};
    });
});

export const deleteParkingRate = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const rateId = validateDocId((request.data as {rateId?: string})?.rateId, "rateId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const rateSnap = await txn.get(db.collection("parkingRates").doc(rateId));
        if (!rateSnap.exists) throw new HttpsError("not-found", "Parking rate not found.");

        // Cascade unlink: clear this rateId from every lot that references it.
        const lotsSnap = await txn.get(db.collection("parkingLots").where("rateId", "==", rateId));
        let unlinkedFrom = 0;
        for (const doc of lotsSnap.docs) {
            txn.update(doc.ref, {rateId: ""});
            unlinkedFrom++;
        }

        txn.delete(db.collection("parkingRates").doc(rateId));
        txn.set(recordRef(), recordDoc("parkingrate-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            rateLabel: rateSnap.data()?.labelEn ?? rateId,
            unlinkedFrom,
        }));
        return {deleted: true, unlinkedFrom};
    });
});

export const saveVenue = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const venueId = input.venueId ? validateDocId(input.venueId, "venueId") : null;
    const nameEn = sanitizeDisplayText(validateStr(input.nameEn, "nameEn", 200, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 200));
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    const rawLots = Array.isArray(input.parkingLots) ? input.parkingLots : [];
    if (rawLots.length > 50) {
        throw new HttpsError("invalid-argument", "Too many parking lots (max 50).");
    }
    const parkingLots = rawLots.map((link: any, i: number) => ({
        lotId: validateDocId(link?.lotId, `parkingLots[${i}].lotId`),
    }));
    const seenLotIds = new Set<string>();
    for (const l of parkingLots) {
        if (seenLotIds.has(l.lotId)) {
            throw new HttpsError("invalid-argument", `Duplicate lotId in parkingLots: ${l.lotId}.`);
        }
        seenLotIds.add(l.lotId);
    }

    const docId = venueId ?? db.collection("venues").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (venueId) {
            const existing = await txn.get(db.collection("venues").doc(venueId));
            if (!existing.exists) throw new HttpsError("not-found", "Venue not found.");
        }

        for (const link of parkingLots) {
            const lotSnap = await txn.get(db.collection("parkingLots").doc(link.lotId));
            if (!lotSnap.exists) {
                throw new HttpsError("not-found", `Referenced parking lot not found: ${link.lotId}.`);
            }
        }

        const ref = db.collection("venues").doc(docId);
        const data = {nameEn, nameCn, lat, lng, parkingLots};
        if (venueId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(recordRef(), recordDoc(venueId ? "venue-edit" : "venue-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            venueId: docId,
            venueName: nameEn,
        }));
        return {venueId: docId};
    });
});
export const deleteVenue = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const venueId = validateDocId((request.data as {venueId?: string})?.venueId, "venueId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const venueSnap = await txn.get(db.collection("venues").doc(venueId));
        if (!venueSnap.exists) throw new HttpsError("not-found", "Venue not found.");

        txn.delete(db.collection("venues").doc(venueId));
        txn.set(recordRef(), recordDoc("venue-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            venueName: venueSnap.data()?.nameEn ?? venueId,
        }));
        return {deleted: true};
    });
});
export const saveTeamMembers = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {teamMembers?: any[]};
    const members = Array.isArray(input.teamMembers) ? input.teamMembers : [];
    const validMembers = members.map(m => {
        const useAccountRole = Boolean(m.useAccountRole);
        const useAccountPhoto = Boolean(m.useAccountPhoto);
        // The stored role is only a fallback when it follows the linked account (resolved live
        // at read time), so require it only when custom — this matches the client's canSave and
        // allows following an account with no title set. The name is always custom, so always
        // required.
        const name = sanitizeDisplayText(validateStr(m.name, "name", 200, true));
        if (!name) throw new HttpsError("invalid-argument", "name is required.");
        const imageUrl = validateStr(m.imageUrl, "imageUrl", 500);
        // Team photos are either a team/<uuid>.webp storage URL or, for a member
        // following their account, the account's photoURL fallback — which may be a
        // Google avatar URL, so validate https rather than a storage-only URL.
        validateUrl(imageUrl, "imageUrl");
        return {
            id: validateStr(m.id, "id", 128, true),
            uid: m.uid ? validateStr(m.uid, "uid", 128) : "",
            name,
            nameCn: sanitizeDisplayText(validateStr(m.nameCn, "nameCn", 200)),
            role: sanitizeDisplayText(validateStr(m.role, "role", 200, !useAccountRole)),
            roleCn: sanitizeDisplayText(validateStr(m.roleCn, "roleCn", 200)),
            imageUrl,
            isHonorary: Boolean(m.isHonorary),
            useAccountRole,
            useAccountPhoto,
        };
    });

    // Public projection stored in the world-readable config/main doc — display
    // fields only, never the linked-account uid or the follow flags. The full
    // roster (with uid/flags) lives in the server-only teamRoster/main doc, read
    // back by getPublicTeamMembers (to resolve live account data) and getTeamRoster
    // (the admin editor).
    const publicMembers = validMembers.map(m => ({
        id: m.id,
        name: m.name,
        nameCn: m.nameCn,
        role: m.role,
        roleCn: m.roleCn,
        imageUrl: m.imageUrl,
        isHonorary: m.isHonorary,
    }));

    const configRef = db.collection("config").doc("main");
    const rosterRef = db.collection("teamRoster").doc("main");
    const orphanedImages = await adminTransaction(uid, async (txn, callerSnap) => {
        // Each avatar upload writes a new team/<uuid>.webp rather than overwriting, so images
        // this save stops referencing — replaced ones, and those of removed members — are left
        // behind and deleted once the save commits. A member following their account stores the
        // account photo as its fallback; that lives outside team/ and the prefix guard below
        // keeps it safe. Read before the writes, as transactions require.
        const rosterSnap = await txn.get(rosterRef);
        const prevMembers = (rosterSnap.data()?.teamMembers ?? []) as {imageUrl?: string}[];
        await requireNewlyLinkedFilesExist(validMembers.map(m => m.imageUrl), prevMembers.map(m => m.imageUrl ?? ""));
        const stillReferenced = new Set(validMembers.map(m => m.imageUrl).filter(Boolean));
        const orphaned = [...new Set(
            prevMembers
                .map(m => m.imageUrl ?? "")
                .filter(url => url && !stillReferenced.has(url))
        )];

        // Full roster (server-only) and public projection (world-readable) written
        // together so the two never drift.
        txn.set(rosterRef, {
            teamMembers: validMembers,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(configRef, {
            teamMembers: publicMembers,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        txn.set(recordRef(), recordDoc("config-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            configSections: ["team"],
        }));
        return orphaned;
    });

    for (const url of orphanedImages) {
        await deleteStorageFile(url, ["team/"])
            .catch(logStorageCleanupError(`saveTeamMembers ${url}`));
    }

    return {saved: true};
});

// Group labels for accounts without an explicit title (e.g. the president, whose
// effective title is simply "President"). Kept in sync with the client's GROUP_LABELS.
const GROUP_LABELS: Record<string, {en: string; zh: string}> = {
    "user": {en: "User", zh: "用户"},
    "staff": {en: "Staff", zh: "工作人员"},
    "core-staff": {en: "Core Staff", zh: "核心成员"},
    "president": {en: "President", zh: "社长"},
};

// An account's effective title per language: its explicit title, else its group label.
const accountEffectiveTitle = (acc: {group: string; title: string; titleCn: string}) => {
    const labels = GROUP_LABELS[acc.group] ?? {en: "", zh: ""};
    return {
        en: acc.title || acc.titleCn || labels.en,
        zh: acc.titleCn || acc.title || labels.zh,
    };
};

// Public (unauthenticated) resolver for the "Our Team" section on the landing page.
// The public site cannot read the users collection directly (Firestore rules gate it
// to staff/self), so members that opt a field into following their linked account have
// role/photo resolved here from the account's live title/photoURL. Names are always the
// admin's stored custom value and never resolved from the account. Only members the admin
// explicitly placed on the public team are looked up, and no email is exposed.
export const getPublicTeamMembers = onCall({maxInstances: 20}, async () => {
    // Full roster (with uid/flags) lives in the server-only teamRoster/main doc.
    const rosterSnap = await db.collection("teamRoster").doc("main").get();
    const members = (rosterSnap.data()?.teamMembers ?? []) as Record<string, unknown>[];

    const follows = (m: Record<string, unknown>) => ({
        role: Boolean(m.useAccountRole),
        photo: Boolean(m.useAccountPhoto),
    });

    const linkedUids = [...new Set(
        members
            .filter(m => typeof m?.uid === "string" && m.uid)
            .filter(m => {
                const f = follows(m);
                return f.role || f.photo;
            })
            .map(m => m.uid as string)
    )];

    const accounts = new Map<string, {
        title: string;
        titleCn: string;
        group: string;
        photoURL: string
    }>();
    if (linkedUids.length > 0) {
        const snaps = await db.getAll(...linkedUids.map(uid => db.collection("users").doc(uid)));
        for (const snap of snaps) {
            if (!snap.exists) continue;
            const d = snap.data()!;
            accounts.set(snap.id, {
                title: (d.title as string) ?? "",
                titleCn: (d.titleCn as string) ?? "",
                group: normalizeGroup(d.group),
                photoURL: (d.photoURL as string) ?? "",
            });
        }
    }

    const teamMembers = members.map(m => {
        const acc = typeof m?.uid === "string" ? accounts.get(m.uid) : undefined;
        const f = acc ? follows(m) : {role: false, photo: false};
        // The role toggle governs both languages: English role follows the account's English
        // title, Chinese role its Chinese title, each falling back to the account's group label
        // (so a president with no title shows "President") and then to the stored custom value.
        const title = acc ? accountEffectiveTitle(acc) : {en: "", zh: ""};
        const role = (m.role as string) ?? "";
        const roleCn = (m.roleCn as string) ?? "";
        const imageUrl = (m.imageUrl as string) ?? "";
        // Project only display fields — never the internal linked-account uid or the
        // admin-side follow flags.
        return {
            id: (m.id as string) ?? "",
            name: (m.name as string) ?? "",
            nameCn: (m.nameCn as string) ?? "",
            role: f.role ? (title.en || role) : role,
            roleCn: f.role ? (title.zh || roleCn) : roleCn,
            imageUrl: f.photo ? (acc?.photoURL || imageUrl) : imageUrl,
            isHonorary: Boolean(m.isHonorary),
        };
    });

    return {teamMembers};
});

// Admin-side roster read for the "Our Team" editor. The full roster (linked-account
// uid + follow flags) lives in the server-only teamRoster/main doc — never a
// client-readable one — so the editor fetches it through this callable instead of
// reading config directly. Gated to staff+ to match who can view the site-config
// tab (core-staff edit, staff read-only); writes still go through saveTeamMembers,
// which is core-staff+.
export const getTeamRoster = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await db.collection("users").doc(uid).get();
    const group = callerSnap.data()?.group;
    if (!["staff", "core-staff", "president"].includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    const rosterSnap = await db.collection("teamRoster").doc("main").get();
    return {teamMembers: rosterSnap.data()?.teamMembers ?? []};
});

// What Site Config's Sender Email section shows around the prefix field. The
// domain comes from PUBLIC_ORIGIN on the server, which the client can't see.
// Staff+ like getTeamRoster, since staff view Site Config read-only.
export const getSenderSettings = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await db.collection("users").doc(uid).get();
    if (!["staff", "core-staff", "president"].includes(callerSnap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return {domain: SENDER_DOMAIN, defaultPrefix: DEFAULT_SENDER_PREFIX};
});

// Outbound-email capacity for the admin panel's Email Quota tool. Core-staff+
// only, like the sends it describes.
//
// Two different numbers come back, and the distinction is the point:
//
//   providerReported — the provider's own used count, i.e. what the provider's
//                      dashboard shows. Taken live per request via
//                      syncProviderUsage. null when unavailable.
//   sentToday        — the local counter that actually gates sends
//                      (confirmed + in-flight reservations). Runs slightly
//                      ahead of the provider while sends are in flight.
//
// Reporting only the local counter is what made this view disagree with the
// Resend dashboard: system/resendQuota is written solely as a side effect of
// sending, so between sends it sits at a high-water mark while the provider's
// rolling window keeps rolling. Re-reading the provider re-anchors it here.
export const getEmailQuotaStatus = onCall({
    maxInstances: 5,
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    // Live reading first, folded into the cache with a zero send-delta so it
    // refreshes `confirmed` without disturbing in-flight reservations. Every
    // later read in this request then sees the fresh value. Also benefits the
    // send path: an admin opening this panel re-anchors the counter that
    // sendTicketEmails will use.
    //
    // Reading mid-send can briefly double-count: the provider may already have
    // counted envelopes whose response hasn't landed, while `reserved` still
    // holds them. That errs toward over-counting, which is the safe direction
    // for cap enforcement, and settles as soon as the send response releases
    // its reservation.
    const usage = await syncProviderUsage();

    const [quota, queue, fromAddress] = await Promise.all([
        computeEmailQuotaDetail(),
        getScheduledMailQueueStatus(),
        getSenderAddress(),
    ]);

    // "cached" means the live read came back empty but a past send did record
    // a reading — show it, aged, rather than pretending to be current.
    // "unavailable" means we have never obtained a usage figure at all; the
    // panel must not render that as 0 of 100.
    const readingSource = usage !== null ? "live"
        : quota.observedAt !== null ? "cached"
            : "unavailable";

    return {
        provider: {
            id: EMAIL_PROVIDER.id,
            name: EMAIL_PROVIDER.name,
            windowKind: EMAIL_PROVIDER.windowKind,
            fromAddress,
        },
        providerReported: readingSource === "unavailable" ? null : quota.confirmed,
        readingSource,
        // Set when the scan hit its page budget before reaching the window
        // edge, so the panel can present the figure as a floor.
        usageTruncated: usage?.truncated ?? false,
        ...quota,
        ...queue,
        queueCap: RESEND_QUEUE_CAP,
        drainIntervalMinutes: DRAIN_INTERVAL_MINUTES,
        // Server clock, so the client can age observedAt/oldestQueuedAt
        // without trusting a possibly-skewed local clock.
        serverNow: new Date().toISOString(),
    };
});
