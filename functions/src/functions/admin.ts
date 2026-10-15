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
import { UW_BUILDING_CODE_RE, UW_LOT_CODE_RE } from "../utils/uwParking";
import { dropVenueParking, refreshVenueParking } from "./parking";

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
 * The con hero's background loop. Kept apart from `uploadAdminImage` because
 * every check differs (content types, magic bytes, size cap, prefix), and
 * folding video in would give every image upload the video size ceiling.
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

    // WebM only: the hero lists a single WebM source, so an MP4 stored here
    // would be refused by every browser.
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

// The upload caps, for the web app's early size check and "up to N MB" hints,
// read from the env that enforces them. Public: members check their own photos
// against the image cap.
export const getUploadLimits = onCall({maxInstances: 10}, async () => ({
    imageMb: MAX_UPLOAD_SIZE_MB,
    videoMb: MAX_VIDEO_UPLOAD_SIZE_MB,
}));

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
// picUrl is an untrusted field from Bilibili's API; fetching it unchecked would
// be an SSRF vector, so only Bilibili's image CDNs are allowed.
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

// Con edition posters are config/con-<year>-<stamp>.webp, matched exactly
// because guest photos (config/con-guest-*) share the prefix.
const CON_EDITION_IMAGE_PATH = /^config\/con-\d+-/;

// Each account's link in the one form the Site Config form builds
// (SOCIAL_LINK_FORMATS in app/pages/admin/socialLinkInput.ts); keys mirror
// SOCIAL_LINK_KEYS in app/lib/siteConfig.ts. Pinning the host keeps every link
// on the platform it is shown as.
const SOCIAL_LINK_PATTERNS: Record<string, RegExp> = {
    discord: /^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/,
    instagram: /^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/,
    bilibili: /^https:\/\/space\.bilibili\.com\/\d+$/,
    xiaohongshu: /^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[0-9a-f]{24}$/,
    linkedin: /^https:\/\/www\.linkedin\.com\/company\/[A-Za-z0-9-]+\/$/,
    github: /^https:\/\/github\.com\/[A-Za-z0-9-]+$/,
};

// Xiaohongshu shares profiles as short links that redirect; the form passes one
// through for resolveXiaohongshuShareLink.
const XIAOHONGSHU_SHARE_LINK = /^https:\/\/xhslink\.(?:cn|com)\/[A-Za-z0-9/]+$/;

/** Every key in SOCIAL_LINK_PATTERNS, each a link in its pattern or "" (which hides that link). */
function validateSocialLinks(value: unknown): Record<string, string> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new HttpsError("invalid-argument", "Invalid socialLinks.");
    }
    const input = value as Record<string, unknown>;
    const unknownKey = Object.keys(input).find(key => !(key in SOCIAL_LINK_PATTERNS));
    if (unknownKey) throw new HttpsError("invalid-argument", `Unknown social link: ${unknownKey}.`);

    const links: Record<string, string> = {};
    for (const [key, pattern] of Object.entries(SOCIAL_LINK_PATTERNS)) {
        const link = validateStr(input[key], `${key} link`, 500).trim();
        if (link && !pattern.test(link) && !(key === "xiaohongshu" && XIAOHONGSHU_SHARE_LINK.test(link))) {
            throw new HttpsError("invalid-argument", `Invalid ${key} link.`);
        }
        links[key] = link;
    }
    return links;
}

/**
 * The profile a Xiaohongshu share link opens, without the sharer's tracking
 * parameters.
 */
async function resolveXiaohongshuShareLink(shareLink: string): Promise<string> {
    let target = "";
    try {
        const resp = await fetch(shareLink, {
            redirect: "manual",
            headers: {"User-Agent": "Mozilla/5.0"},
            signal: AbortSignal.timeout(5000),
        });
        target = resp.headers.get("location") ?? "";
    } catch {
        // Unreachable reads the same as a link to something else, below.
    }
    const id = target.match(/^https:\/\/www\.xiaohongshu\.com\/user\/profile\/([0-9a-f]{24})(?:[/?#]|$)/)?.[1];
    if (!id) {
        throw new HttpsError("invalid-argument",
            "That Xiaohongshu share link doesn't open a profile. Paste the profile link or user ID instead.");
    }
    return `https://www.xiaohongshu.com/user/profile/${id}`;
}

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

    // Only the part before the @; the domain is always SENDER_DOMAIN. "" falls
    // back to DEFAULT_SENDER_PREFIX.
    const senderPrefix = input.senderPrefix === undefined ? undefined
        : input.senderPrefix === "" ? ""
            : validateSenderPrefix(input.senderPrefix, "senderPrefix");

    const socialLinks = input.socialLinks === undefined ? undefined : validateSocialLinks(input.socialLinks);

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

    // Checked before the Bilibili fetch and the config/video-cover write, which
    // happen outside adminTransaction; otherwise any signed-in user could
    // trigger a server-side fetch and overwrite the public cover.
    await requireAdmin(uid);

    // Also a server-side fetch, so also behind the admin check.
    if (socialLinks && XIAOHONGSHU_SHARE_LINK.test(socialLinks.xiaohongshu)) {
        socialLinks.xiaohongshu = await resolveXiaohongshuShareLink(socialLinks.xiaohongshu);
    }

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
                        // Trust the bytes, not the content-type header.
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
            // Best effort: save without a cover.
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
        if (socialLinks !== undefined) {
            updateData.socialLinks = socialLinks;
            configSections.push("social-links");
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

    // Each upload is a new time-stamped object, so the image this save replaces
    // or drops is deleted here.
    const oldConImagePath = extractStoragePath(oldConImage);
    if (oldConImagePath
        && oldConImagePath !== extractStoragePath(conEdition?.image ?? "")
        && CON_EDITION_IMAGE_PATH.test(oldConImagePath)) {
        await deleteStorageFile(oldConImage)
            .catch(logStorageCleanupError("saveSiteConfig con edition"));
    }

    // The links as stored, so the form can show the profile a share link opened.
    return socialLinks ? {saved: true, socialLinks} : {saved: true};
});

// Mirrors ROOM_ACCENTS in app/lib/conContent.ts. Each value names a CSS class
// (sbc-accent--<accent>), so it's a whitelist.
const CON_ROOM_ACCENTS = ["pink", "violet", "amber", "sky", "mint", "slate"] as const;

const CON_SECTIONS = [
    "settings", "event", "heroVideo", "rooms", "schedule", "guests", "cafe", "vendors", "tickets", "ticketFee",
    "inPersonSales", "faq",
] as const;
type ConSection = typeof CON_SECTIONS[number];

// Mirrors HIDEABLE_SECTIONS in app/lib/conContent.ts.
const CON_HIDEABLE_SECTIONS = ["guests", "vendors"] as const satisfies readonly ConSection[];

// Generous against real use, but bounded so a runaway client can't grow the
// public document indefinitely.
const CON_LIMITS = {
    rooms: 24,
    scheduleItems: 120,
    guests: 60,
    maids: 40,
    tickets: 8,
    perks: 12,
    inPersonSessions: 30,
    faq: 40,
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mirrors HALL_TABLES in app/pages/con/hall.ts: the hall floor plan's tables, in
// plan order. A vendor can only sit at one of these.
const CON_HALL_TABLES = ([["A", 15], ["B", 15], ["C", 15], ["D", 15], ["E", 3]] as const)
    .flatMap(([row, count]) => Array.from({length: count}, (_, i) => `${row}${i + 1}`));

interface LocalizedText {
    en: string;
    zh: string;
}

/**
 * Con copy is stored as {en, zh} pairs, the way the con page reads it, rather
 * than `field`/`fieldCn` columns.
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
 * A con asset is either a Storage download URL or a root-relative path under
 * public/; anything else is rejected, so the page only loads files from hosts we
 * control.
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
 * Page-level switches. `published` is a strict boolean because a stray truthy
 * value would republish the page. Leaving `hiddenSections` out shows every
 * section.
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
 * The hero's background loop; without one the hero shows a gradient. The
 * extension must match the container the source element claims, or a browser
 * silently drops the source.
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
 * Ids for rows the admin never sees (ticket tiers). The index-derived fallback can
 * collide with an existing id after a delete, so a duplicate is renamed rather than
 * rejected: the editor has no id field to fix it in.
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
        // Both times absent means TBA; exactly one is a half-filled form.
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
        // HH:MM compares as a string. That rules out items past midnight, which
        // is fine for a single-day con and catches the common "17:30–15:30" typo.
        if (times.start && times.end && times.end <= times.start) {
            throw new HttpsError(
                "invalid-argument",
                `A schedule item ends at ${times.end}, which is not after its ${times.start} start.`,
            );
        }

        // A scheduled item needs a room to be drawn in; a TBA one has none yet, so
        // it is stored only when there is one.
        const room = hasStart
            ? sanitizeDisplayText(validateStr(item.room, "item room", 60, true))
            : "";

        return {
            ...times,
            ...(room ? {room} : {}),
            title: validateLocalized(item.title, "item title", 200, true),
        };
    })
        // Stored in start order, so the editor needs no reorder buttons; TBA
        // items sort last.
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

/**
 * The maid café. Its hours are both or neither, like a schedule item's, and every
 * poster is optional.
 */
function buildConCafe(raw: unknown) {
    const c = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const hasStart = c.start !== undefined && c.start !== null && c.start !== "";
    const hasEnd = c.end !== undefined && c.end !== null && c.end !== "";
    if (hasStart !== hasEnd) {
        throw new HttpsError("invalid-argument", "The café needs both an opening and a closing time, or neither.");
    }
    const start = hasStart ? validateConTime(c.start, "café opening time") : "";
    const end = hasEnd ? validateConTime(c.end, "café closing time") : "";
    // HH:MM sorts chronologically, as in buildConSchedule.
    if (start && end <= start) {
        throw new HttpsError("invalid-argument", `The café closes at ${end}, which is not after its ${start} opening.`);
    }

    return {
        theme: validateLocalized(c.theme, "café theme", 120),
        intro: validateLocalized(c.intro, "café intro", 1000),
        location: validateLocalized(c.location, "café location", 120),
        start,
        end,
        poster: validateConAsset(c.poster, "café poster"),
        maids: validateConArray(c.maids, "maids", CON_LIMITS.maids).map(maid => ({
            name: sanitizeDisplayText(validateStr(maid.name, "maid name", 120, true)),
            poster: validateConAsset(maid.poster, "maid poster"),
        })),
    };
}

function buildConVendors(raw: unknown) {
    const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const cta = v.cta && typeof v.cta === "object" ? v.cta as Record<string, unknown> : {};
    const seen = new Set<string>();
    const tables = validateConArray(v.tables, "vendor tables", CON_HALL_TABLES.length).map(vendor => {
        const table = typeof vendor.table === "string" ? vendor.table : "";
        if (!CON_HALL_TABLES.includes(table)) {
            throw new HttpsError("invalid-argument", `"${table}" is not a table on the floor plan.`);
        }
        if (seen.has(table)) {
            throw new HttpsError("invalid-argument", `Table ${table} is listed twice.`);
        }
        seen.add(table);
        return {
            table,
            name: sanitizeDisplayText(validateStr(vendor.name, `Table ${table} name`, 120, true)),
            link: validateConLink(vendor.link, `Table ${table} link`),
        };
    })
        // Stored in plan order, as the editor keeps its draft.
        .sort((a, b) => CON_HALL_TABLES.indexOf(a.table) - CON_HALL_TABLES.indexOf(b.table));

    return {
        tables,
        cta: {
            visible: cta.visible === true,
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

        // An early bird is all or nothing: its own price and a deadline.
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
        // Stored in date order, so the editor needs no reorder buttons.
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
    cafe: buildConCafe,
    vendors: buildConVendors,
    tickets: buildConTickets,
    ticketFee: buildConTicketFee,
    inPersonSales: buildConInPersonSales,
    faq: buildConFaq,
};

/**
 * Where the con editor uploads: the hero clip and café posters under con/, and
 * guest photos.
 */
const CON_ASSET_PREFIXES = ["con/", "config/con-guest-"];

/**
 * Every file URL con content points at; deleteStorageFile skips the ones that
 * aren't Storage URLs.
 */
function conAssetUrls(content: Record<string, any>): string[] {
    const guests: any[] = Array.isArray(content.guests) ? content.guests : [];
    const maids: any[] = Array.isArray(content.cafe?.maids) ? content.cafe.maids : [];
    return [
        content.heroVideo?.webm,
        ...guests.map(guest => guest?.avatar),
        content.cafe?.poster,
        ...maids.map(maid => maid?.poster),
    ].filter((url): url is string => typeof url === "string" && url !== "");
}

/**
 * Writes one or more sections of the /con page.
 *
 * Each section saves on its own, merged, so two people editing different sections
 * can't overwrite each other.
 *
 * Everything lands in the staff-only `conContent/draft`. `conContent/main` is a
 * whole-document mirror that exists only while the con is published, so an
 * unannounced line-up is not on the public web at all. Read rules are in
 * firestore.rules.
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

        // Rooms and the schedule can be saved separately, so check this write
        // against the side it isn't carrying: that catches both an item pointing
        // at a missing room and a room deleted while still in use.
        if (updateData.rooms !== undefined || updateData.schedule !== undefined) {
            const rooms = updateData.rooms ?? stored.rooms;
            // Rooms never saved means the page is on the code defaults, which the
            // server can't see.
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

        // The public mirror exists only while the con is published, and leaves out
        // hidden sections, so nothing hidden is readable from the database directly.
        // Written whole so a section deleted in the draft can't survive, and without
        // `updatedBy`, which doesn't belong on a public doc.
        const merged = {...stored, ...updateData};
        const settings = merged.settings as {published?: boolean; hiddenSections?: string[]} | undefined;
        const published = settings?.published === true;
        if (published) {
            // Only sections that can still be hidden; a stored draft may name one
            // that no longer can.
            const hideable: readonly string[] = CON_HIDEABLE_SECTIONS;
            const hidden = new Set((settings?.hiddenSections ?? []).filter(section => hideable.includes(section)));
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

        // Each upload is a new time-stamped object, so files this save replaces or
        // drops are deleted once it commits. Both documents now name the files
        // `merged` does, so one it doesn't name is unreferenced.
        const stillReferenced = new Set(conAssetUrls(merged));
        return [...new Set(conAssetUrls(stored))].filter(url => !stillReferenced.has(url));
    });

    await Promise.all(orphanedAssets.map(url =>
        deleteStorageFile(url, CON_ASSET_PREFIXES)
            .catch(logStorageCleanupError(`saveConContent ${url}`))));

    return {saved: true};
});

const MAX_SUGGESTED_LOTS = 10;

/**
 * A venue's UW fields from a save: its building code and the UW lots suggested
 * for it, by facility code. Codes are checked for shape only; a lot UW later
 * drops is skipped by the guide.
 */
function venueUwFields(input: Record<string, unknown>): {
    buildingCode: string;
    suggestedLots: {code: string; noteEn: string; noteCn: string}[];
} {
    const buildingCode = validateStr(input.buildingCode, "buildingCode", 8).trim().toUpperCase();
    if (buildingCode && !UW_BUILDING_CODE_RE.test(buildingCode)) {
        throw new HttpsError("invalid-argument", `Invalid buildingCode: ${buildingCode}.`);
    }
    if (!Array.isArray(input.suggestedLots)) {
        throw new HttpsError("invalid-argument", "suggestedLots must be a list.");
    }
    if (input.suggestedLots.length > MAX_SUGGESTED_LOTS) {
        throw new HttpsError("invalid-argument", `Too many suggested lots (max ${MAX_SUGGESTED_LOTS}).`);
    }
    const seen = new Set<string>();
    const suggestedLots = input.suggestedLots.map((lot: any, i: number) => {
        const code = validateStr(lot?.code, `suggestedLots[${i}].code`, 12, true).trim().toUpperCase();
        if (!UW_LOT_CODE_RE.test(code)) {
            throw new HttpsError("invalid-argument", `Invalid UW lot code: ${code}.`);
        }
        if (seen.has(code)) throw new HttpsError("invalid-argument", `Duplicate suggested lot: ${code}.`);
        seen.add(code);
        return {
            code,
            noteEn: sanitizeDisplayText(validateStr(lot?.noteEn, `suggestedLots[${i}].noteEn`, 300)),
            noteCn: sanitizeDisplayText(validateStr(lot?.noteCn, `suggestedLots[${i}].noteCn`, 300)),
        };
    });
    return {buildingCode, suggestedLots};
}

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

    const {buildingCode, suggestedLots} = venueUwFields(input);

    const docId = venueId ?? db.collection("venues").doc().id;

    await adminTransaction(uid, async (txn, callerSnap) => {
        if (venueId) {
            const existing = await txn.get(db.collection("venues").doc(venueId));
            if (!existing.exists) throw new HttpsError("not-found", "Venue not found.");
        }

        const ref = db.collection("venues").doc(docId);
        const data = {nameEn, nameCn, lat, lng, buildingCode, suggestedLots};
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
    });

    // A new, moved or re-coded venue gets walking times and its outline now rather
    // than at the nightly sync. Best effort: the save has committed, and the sync
    // refreshes them anyway.
    await refreshVenueParking(docId, {lat, lng, buildingCode})
        .catch(err => console.error("saveVenue: parking data not refreshed for", docId, err));
    return {venueId: docId};
});
export const deleteVenue = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const venueId = validateDocId((request.data as {venueId?: string})?.venueId, "venueId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const venueSnap = await txn.get(db.collection("venues").doc(venueId));
        if (!venueSnap.exists) throw new HttpsError("not-found", "Venue not found.");

        txn.delete(db.collection("venues").doc(venueId));
        txn.set(recordRef(), recordDoc("venue-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            venueName: venueSnap.data()?.nameEn ?? venueId,
        }));
    });
    // Best effort, like the refresh on save; the nightly sync drops it otherwise.
    await dropVenueParking(venueId)
        .catch(err => console.error("deleteVenue: parking data not dropped for", venueId, err));
    return {deleted: true};
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
        // The stored role is only a fallback when it follows the linked account, so it is
        // required only when custom, matching the client's canSave. The name is always custom.
        const name = sanitizeDisplayText(validateStr(m.name, "name", 200, true));
        if (!name) throw new HttpsError("invalid-argument", "name is required.");
        const imageUrl = validateStr(m.imageUrl, "imageUrl", 500);
        // A team/<uuid>.webp upload, or for a member following their account its
        // photoURL, which may be a Google avatar: hence https rather than
        // storage-only.
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

    // Display fields only, for the world-readable config/main doc. The full roster,
    // with uids and follow flags, lives in the server-only teamRoster/main.
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
        // Each avatar upload is a new team/<uuid>.webp, so images this save stops referencing
        // are deleted once it commits. Account photos live outside team/, so the prefix guard
        // below keeps them. Read before the writes, as transactions require.
        const rosterSnap = await txn.get(rosterRef);
        const prevMembers = (rosterSnap.data()?.teamMembers ?? []) as {imageUrl?: string}[];
        await requireNewlyLinkedFilesExist(validMembers.map(m => m.imageUrl), prevMembers.map(m => m.imageUrl ?? ""));
        const stillReferenced = new Set(validMembers.map(m => m.imageUrl).filter(Boolean));
        const orphaned = [...new Set(
            prevMembers
                .map(m => m.imageUrl ?? "")
                .filter(url => url && !stillReferenced.has(url))
        )];

        // Written together so the roster and its public projection never drift.
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

    await Promise.all(orphanedImages.map(url =>
        deleteStorageFile(url, ["team/"])
            .catch(logStorageCleanupError(`saveTeamMembers ${url}`))));

    return {saved: true};
});

// For accounts without an explicit title. Keep in sync with the client's GROUP_LABELS.
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

// Public resolver for the landing page's "Our Team". The site can't read users directly,
// so a member who follows their linked account gets its live title and photo resolved
// here. Names are always the admin's own, only members placed on the public team are
// looked up, and no email is exposed.
export const getPublicTeamMembers = onCall({maxInstances: 20}, async () => {
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
        // Each language's role follows the account's title in that language, then its group
        // label, then the stored custom value.
        const title = acc ? accountEffectiveTitle(acc) : {en: "", zh: ""};
        const role = (m.role as string) ?? "";
        const roleCn = (m.roleCn as string) ?? "";
        const imageUrl = (m.imageUrl as string) ?? "";
        // Display fields only: never the linked uid or the follow flags.
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

// The full roster for the "Our Team" editor, from the server-only teamRoster/main.
// Staff+, matching who can view Site Config; saveTeamMembers stays core-staff+.
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

// What Site Config's Sender Email section shows around the prefix field; the
// domain comes from PUBLIC_ORIGIN, which the client can't see. Staff+, like
// getTeamRoster.
export const getSenderSettings = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await db.collection("users").doc(uid).get();
    if (!["staff", "core-staff", "president"].includes(callerSnap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return {domain: SENDER_DOMAIN, defaultPrefix: DEFAULT_SENDER_PREFIX};
});

// Outbound-email capacity for the Email Quota tool. Core-staff+, like the sends
// it describes.
//
// Two numbers come back: providerReported, the provider's own count read live
// (null when unavailable), and sentToday, the local counter that gates sends,
// confirmed plus in-flight. The local counter only updates on sends, so between
// them it drifts from the provider's rolling window; reading the provider here
// re-anchors it.
export const getEmailQuotaStatus = onCall({
    maxInstances: 5,
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    // Folded into the cache with a zero send-delta, which refreshes `confirmed`
    // without touching in-flight reservations, so the rest of this request and
    // the next send see it. Mid-send this can briefly double-count, which errs
    // toward the safe side for the cap.
    const usage = await syncProviderUsage();

    const [quota, queue, fromAddress] = await Promise.all([
        computeEmailQuotaDetail(),
        getScheduledMailQueueStatus(),
        getSenderAddress(),
    ]);

    // "cached": the live read failed but an earlier send recorded one, shown
    // aged. "unavailable": never read at all, which the panel must not show as
    // 0 of 100.
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
        // The scan hit its page budget before the window edge, so the figure is
        // a floor.
        usageTruncated: usage?.truncated ?? false,
        ...quota,
        ...queue,
        queueCap: RESEND_QUEUE_CAP,
        drainIntervalMinutes: DRAIN_INTERVAL_MINUTES,
        // So the client can age observedAt/oldestQueuedAt without trusting its
        // own clock.
        serverNow: new Date().toISOString(),
    };
});
