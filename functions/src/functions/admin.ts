import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, normalizeGroup, requireAdmin, requireAuth, requireStaff } from "../utils/auth";
import { DEFAULT_SENDER_PREFIX, RESEND_QUEUE_CAP, SENDER_DOMAIN } from "../utils/config";
import { db } from "../utils/firebase";
import { EMAIL_PROVIDER, syncProviderUsage } from "../utils/emailProvider";
import { computeEmailQuotaDetail } from "../utils/quota";
import { getSenderAddress, RESEND_API_KEY } from "../utils/resendClient";
import { readWalletQuota, syncWalletUsage, WALLETWALLET_API_KEY } from "../utils/walletPass";
import { DRAIN_INTERVAL_MINUTES, getScheduledMailQueueStatus } from "./scheduledMail";
import { performer, recordDoc, recordRef } from "../utils/records";
import {
    decodeUpload,
    deleteStorageFile,
    detectImageMime,
    detectVideoMime,
    logStorageCleanupError,
    MAX_UPLOAD_SIZE_MB,
    MAX_VIDEO_UPLOAD_SIZE_MB,
    requireNewlyLinkedFilesExist,
    saveUpload,
    validateStoragePath
} from "../utils/storage";
import {
    sanitizeDisplayText,
    validateCoordinate,
    validateDay,
    validateDocId,
    validateEmail,
    validateISODate,
    validateSenderPrefix,
    validateStorageImageUrl,
    validateStr,
    validateUrl
} from "../utils/validation";
import { UW_BUILDING_CODE_RE, UW_LOT_CODE_RE } from "../utils/uwParking";
import { eventLocationText, MAX_ROOMS, type Room, ROOM_ID_RE, venueRooms } from "../utils/events";
import { dropVenueParking, refreshVenueParking } from "./parking";

async function readAdminUpload(request: CallableRequest): Promise<{
    path: string;
    dataBase64: string;
    contentType: string
}> {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

    const {path, data: dataBase64, contentType} = request.data as {
        path?: string;
        data?: string;
        contentType?: string;
    };

    if (!path || !dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing path, data, or contentType.");
    }
    validateStoragePath(path);
    return {path, dataBase64, contentType};
}

export const uploadAdminImage = onCall({maxInstances: 10}, async (request) => {
    const {path, dataBase64, contentType} = await readAdminUpload(request);

    const buffer = decodeUpload(dataBase64, contentType, {
        types: ["image/webp"],
        maxMb: MAX_UPLOAD_SIZE_MB,
        kind: "Image",
        detect: detectImageMime,
    });
    return {url: await saveUpload(path, buffer, contentType)};
});

export const uploadConVideo = onCall({maxInstances: 5, memory: "512MiB"}, async (request) => {
    const {path, dataBase64, contentType} = await readAdminUpload(request);
    if (!path.startsWith("con/")) {
        throw new HttpsError("invalid-argument", "Con videos must be stored under con/.");
    }

    const buffer = decodeUpload(dataBase64, contentType, {
        types: ["video/webm"],
        maxMb: MAX_VIDEO_UPLOAD_SIZE_MB,
        kind: "Video",
        detect: detectVideoMime,
    });
    return {url: await saveUpload(path, buffer, contentType)};
});

export const getUploadLimits = onCall({maxInstances: 10}, async () => ({
    imageMb: MAX_UPLOAD_SIZE_MB,
    videoMb: MAX_VIDEO_UPLOAD_SIZE_MB,
}));

export const saveTag = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const tagId = input.tagId ? validateDocId(input.tagId, "tagId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 100));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const nameLower = name.toLowerCase();
    const docId = tagId ?? db.collection("eventLabels").doc().id;

    await adminTransaction(uid, async (txn, callerSnap) => {
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
            ...performer(uid, callerSnap),
            tagName: name,
        }));
    });
});
export const deleteTag = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const tagId = validateDocId((request.data as {tagId?: string})?.tagId, "tagId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const tagRef = db.collection("eventLabels").doc(tagId);
        const tagSnap = await txn.get(tagRef);
        if (!tagSnap.exists) throw new HttpsError("not-found", "Tag not found.");
        const holding = await txn.get(db.collection("pastEvents").where("tagIds", "array-contains", tagId));

        txn.delete(tagRef);
        for (const doc of holding.docs) txn.update(doc.ref, {tagIds: FieldValue.arrayRemove(tagId)});
        txn.set(recordRef(), recordDoc("tag-delete", {
            ...performer(uid, callerSnap),
            tagName: tagSnap.data()?.name ?? tagId,
        }));
    });
});
export const savePolicy = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const contentEn = validateStr(input.contentEn, "contentEn", 20000);
    const contentCn = validateStr(input.contentCn, "contentCn", 20000);

    await adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("policy").doc("main"), {
            contentEn,
            contentCn,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("policy-update", {
            ...performer(uid, callerSnap),
        }));
    });
});

const SOCIAL_LINK_PATTERNS: Record<string, RegExp> = {
    discord: /^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/,
    instagram: /^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/,
    bilibili: /^https:\/\/space\.bilibili\.com\/\d+$/,
    xiaohongshu: /^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[0-9a-f]{24}$/,
    linkedin: /^https:\/\/www\.linkedin\.com\/company\/[A-Za-z0-9-]+\/$/,
    github: /^https:\/\/github\.com\/[A-Za-z0-9-]+$/,
};

const XIAOHONGSHU_SHARE_LINK = /^https:\/\/xhslink\.(?:cn|com)\/[A-Za-z0-9/]+$/;

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
    }
    const id = target.match(/^https:\/\/www\.xiaohongshu\.com\/user\/profile\/([0-9a-f]{24})(?:[/?#]|$)/)?.[1];
    if (!id) {
        throw new HttpsError("invalid-argument",
            "That Xiaohongshu share link doesn't open a profile. Paste the profile link or user ID instead.");
    }
    return `https://www.xiaohongshu.com/user/profile/${id}`;
}

export const saveSiteConfig = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;

    const contactEmail = input.contactEmail === undefined ? undefined
        : input.contactEmail === "" ? ""
            : validateEmail(input.contactEmail, "contactEmail");

    const senderPrefix = input.senderPrefix === undefined ? undefined
        : input.senderPrefix === "" ? ""
            : validateSenderPrefix(input.senderPrefix, "senderPrefix");

    const socialLinks = input.socialLinks === undefined ? undefined : validateSocialLinks(input.socialLinks);

    await requireAdmin(uid);

    if (socialLinks && XIAOHONGSHU_SHARE_LINK.test(socialLinks.xiaohongshu)) {
        socialLinks.xiaohongshu = await resolveXiaohongshuShareLink(socialLinks.xiaohongshu);
    }

    const configRef = db.collection("config").doc("main");
    await adminTransaction(uid, async (txn, callerSnap) => {
        const updateData: Record<string, any> = {
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        };
        const configSections: string[] = [];
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

        txn.set(configRef, updateData, {merge: true});
        txn.set(recordRef(), recordDoc("config-update", {
            ...performer(uid, callerSnap),
            configSections,
        }));
    });

    return {socialLinks};
});

const CON_ROOM_ACCENTS = ["pink", "violet", "amber", "sky", "mint", "slate"] as const;

const CON_SECTIONS = [
    "settings", "event", "heroVideo", "rooms", "schedule", "cafe", "vendors", "tickets", "ticketFee", "inPersonSales",
    "faq",
] as const;
type ConSection = typeof CON_SECTIONS[number];

const CON_LIMITS = {
    rooms: 24,
    scheduleItems: 120,
    maids: 40,
    tickets: 8,
    perks: 12,
    inPersonSessions: 30,
    faq: 40,
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const CON_HALL_TABLES = ([["A", 14], ["B", 14], ["C", 14], ["D", 14], ["E", 3]] as const)
    .flatMap(([row, count]) => Array.from({length: count}, (_, i) => `${row}${i + 1}`));

const asRecord = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === "object" ? raw as Record<string, unknown> : {};

const isFilled = (value: unknown): boolean => value !== undefined && value !== null && value !== "";

interface LocalizedText {
    en: string;
    zh: string;
}

function validateLocalized(raw: unknown, name: string, maxLen: number, required = false): LocalizedText {
    const value = asRecord(raw);
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
    return raw.map(asRecord);
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

function buildConSettings(raw: unknown) {
    const s = asRecord(raw);
    if (typeof s.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be true or false.");
    }
    return {published: s.published};
}

function buildConEvent(raw: unknown) {
    const e = asRecord(raw);

    if (!e.upcomingEventId) throw new HttpsError("invalid-argument", "Select the con's upcoming event.");
    const upcomingEventId = validateDocId(e.upcomingEventId, "upcomingEventId");

    return {
        tagline: validateLocalized(e.tagline, "tagline", 300),
        intro: validateLocalized(e.intro, "intro", 2000),
        upcomingEventId,
    };
}

function buildConHeroVideo(raw: unknown) {
    const v = asRecord(raw);
    const webm = validateConAsset(v.webm, "hero webm");
    if (webm && !/\.webm(\?|$)/i.test(webm)) {
        throw new HttpsError("invalid-argument", "The clip must be a .webm file.");
    }
    return {webm};
}

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
        const hasStart = isFilled(item.start);
        const hasEnd = isFilled(item.end);
        if (hasStart !== hasEnd) {
            throw new HttpsError(
                "invalid-argument",
                "An item needs both a start and an end time, or neither (TBA).",
            );
        }
        const times = hasStart
            ? {start: validateConTime(item.start, "item start"), end: validateConTime(item.end, "item end")}
            : {};
        if (times.start && times.end && times.end <= times.start) {
            throw new HttpsError(
                "invalid-argument",
                `A schedule item ends at ${times.end}, which is not after its ${times.start} start.`,
            );
        }

        const room = hasStart
            ? sanitizeDisplayText(validateStr(item.room, "item room", 60, true))
            : "";

        return {
            ...times,
            ...(room ? {room} : {}),
            title: validateLocalized(item.title, "item title", 200, true),
        };
    })
        .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
}

function buildConCafe(raw: unknown) {
    const c = asRecord(raw);
    const hasStart = isFilled(c.start);
    const hasEnd = isFilled(c.end);
    if (hasStart !== hasEnd) {
        throw new HttpsError("invalid-argument", "The café needs both an opening and a closing time, or neither.");
    }
    const start = hasStart ? validateConTime(c.start, "café opening time") : "";
    const end = hasEnd ? validateConTime(c.end, "café closing time") : "";
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
    const v = asRecord(raw);
    const cta = asRecord(v.cta);
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

        const hasEarlyBird = tier.earlyBird !== undefined && tier.earlyBird !== null;
        const price = validateConPrice(tier.price, `${name.en} price`);
        let earlyBird: {price: number; endsAt: string} | undefined;
        if (hasEarlyBird) {
            const e = asRecord(tier.earlyBird);
            earlyBird = {
                price: validateConPrice(e.price, `${name.en} early bird price`),
                endsAt: requireISODate(e.endsAt, `${name.en} early bird end`),
            };
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
    const f = asRecord(raw);
    const percent = f.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new HttpsError("invalid-argument", "Invalid fee percent: must be from 0 to 100.");
    }
    return {
        percent: Math.round(percent * 100) / 100,
        flat: validateConPrice(f.flat, "flat fee"),
    };
}

function buildConInPersonSales(raw: unknown) {
    const s = asRecord(raw);
    const sessions = validateConArray(s.sessions, "in-person sessions", CON_LIMITS.inPersonSessions)
        .map(session => {
            const date = validateDay(session.date, "in-person sale date");
            const start = validateConTime(session.start, `${date} start`);
            const end = validateConTime(session.end, `${date} end`);
            if (end <= start) {
                throw new HttpsError("invalid-argument", `The ${date} in-person sale ends before it starts.`);
            }
            return {date, start, end};
        })
        .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));

    return {
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
    cafe: buildConCafe,
    vendors: buildConVendors,
    tickets: buildConTickets,
    ticketFee: buildConTicketFee,
    inPersonSales: buildConInPersonSales,
    faq: buildConFaq,
};

const CON_ASSET_PREFIXES = ["con/"];

function conAssetUrls(content: Record<string, any>): string[] {
    const maids: any[] = Array.isArray(content.cafe?.maids) ? content.cafe.maids : [];
    return [
        content.heroVideo?.webm,
        content.cafe?.poster,
        ...maids.map(maid => maid?.poster),
    ].filter((url): url is string => typeof url === "string" && url !== "");
}

export const saveConContent = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

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
            const eventSnap = await txn.get(db.collection("upcomingEvents").doc(updateData.event.upcomingEventId));
            if (!eventSnap.exists) {
                throw new HttpsError(
                    "failed-precondition",
                    "The con's upcoming event was archived or deleted. Pick another.",
                );
            }
        }

        if (updateData.rooms !== undefined || updateData.schedule !== undefined) {
            const rooms = (updateData.rooms ?? stored.rooms ?? []) as {id?: string}[];
            const schedule = (updateData.schedule ?? stored.schedule ?? []) as {room?: string}[];
            const ids = new Set(rooms.map(r => r?.id));
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

        txn.set(draftRef, {
            ...updateData,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});

        const merged = {...stored, ...updateData};
        const published = (merged.settings as {published?: boolean} | undefined)?.published === true;
        if (published) {
            const mirror: Record<string, any> = {updatedAt: FieldValue.serverTimestamp()};
            for (const section of CON_SECTIONS) {
                if (merged[section] !== undefined) mirror[section] = merged[section];
            }
            txn.set(publicRef, mirror);
        } else {
            txn.delete(publicRef);
        }

        txn.set(recordRef(), recordDoc("con-content-update", {
            ...performer(uid, callerSnap),
            conSection: sections.join(", "),
        }));

        const stillReferenced = new Set(conAssetUrls(merged));
        return [...new Set(conAssetUrls(stored))].filter(url => !stillReferenced.has(url));
    });

    await Promise.all(orphanedAssets.map(url =>
        deleteStorageFile(url, CON_ASSET_PREFIXES)
            .catch(logStorageCleanupError(`saveConContent ${url}`))));
});

const MAX_SUGGESTED_LOTS = 10;

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

function venueRoomsInput(raw: unknown): Room[] {
    if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "rooms must be a list.");
    if (raw.length > MAX_ROOMS) throw new HttpsError("invalid-argument", `Too many rooms (max ${MAX_ROOMS}).`);
    const ids = new Set<string>();
    const names = new Set<string>();
    return raw.map((room: any, i: number) => {
        const id = validateStr(room?.id, `rooms[${i}].id`, 64, true);
        if (!ROOM_ID_RE.test(id)) throw new HttpsError("invalid-argument", `Invalid rooms[${i}].id.`);
        if (ids.has(id)) throw new HttpsError("invalid-argument", `Duplicate room ID: ${id}.`);
        ids.add(id);
        const nameEn = sanitizeDisplayText(validateStr(room?.nameEn, `rooms[${i}].nameEn`, 100, true));
        if (!nameEn) throw new HttpsError("invalid-argument", `rooms[${i}].nameEn is required.`);
        const key = nameEn.toLowerCase();
        if (names.has(key)) throw new HttpsError("invalid-argument", `Two rooms are named ${nameEn}.`);
        names.add(key);
        return {id, nameEn, nameCn: sanitizeDisplayText(validateStr(room?.nameCn, `rooms[${i}].nameCn`, 100))};
    });
}

export const saveVenue = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const venueId = input.venueId ? validateDocId(input.venueId, "venueId") : null;
    const nameEn = sanitizeDisplayText(validateStr(input.nameEn, "nameEn", 200, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 200));
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    const {buildingCode, suggestedLots} = venueUwFields(input);
    const rooms = venueRoomsInput(input.rooms);

    const docId = venueId ?? db.collection("venues").doc().id;

    const eventsChanged = await adminTransaction(uid, async (txn, callerSnap) => {
        const losing: {ref: FirebaseFirestore.DocumentReference; roomIds: string[]}[] = [];
        if (venueId) {
            const existing = await txn.get(db.collection("venues").doc(venueId));
            if (!existing.exists) throw new HttpsError("not-found", "Venue not found.");
            const kept = new Set(rooms.map(r => r.id));
            const removed = venueRooms(existing.data()).some(r => !kept.has(r.id));
            if (removed) {
                const using = await Promise.all(["upcomingEvents", "pastEvents"].map(col =>
                    txn.get(db.collection(col).where("venueId", "==", venueId))));
                for (const doc of using.flatMap(snap => snap.docs)) {
                    const roomIds: unknown[] = Array.isArray(doc.data().roomIds) ? doc.data().roomIds : [];
                    const left = roomIds.filter((id): id is string => typeof id === "string" && kept.has(id));
                    if (left.length < roomIds.length) losing.push({ref: doc.ref, roomIds: left});
                }
            }
        }

        const ref = db.collection("venues").doc(docId);
        const data = {nameEn, nameCn, lat, lng, buildingCode, suggestedLots, rooms};
        if (venueId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        for (const {ref: eventRef, roomIds} of losing) txn.update(eventRef, {roomIds});
        txn.set(recordRef(), recordDoc(venueId ? "venue-edit" : "venue-create", {
            ...performer(uid, callerSnap),
            venueId: docId,
            venueName: nameEn,
        }));
        return losing.length;
    });

    await refreshVenueParking(docId, {lat, lng, buildingCode})
        .catch(err => console.error("saveVenue: parking data not refreshed for", docId, err));
    return {eventsChanged};
});
export const deleteVenue = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const venueId = validateDocId((request.data as {venueId?: string})?.venueId, "venueId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const venueRef = db.collection("venues").doc(venueId);
        const venueSnap = await txn.get(venueRef);
        if (!venueSnap.exists) throw new HttpsError("not-found", "Venue not found.");
        const using = await Promise.all(["upcomingEvents", "pastEvents"].map(col =>
            txn.get(db.collection(col).where("venueId", "==", venueId))));

        txn.delete(venueRef);
        for (const doc of using.flatMap(snap => snap.docs)) {
            txn.update(doc.ref, {
                venueId: "",
                roomIds: [],
                location: eventLocationText(doc.data(), venueSnap.data(), true),
                locationCn: eventLocationText(doc.data(), venueSnap.data(), false),
            });
        }
        txn.set(recordRef(), recordDoc("venue-delete", {
            ...performer(uid, callerSnap),
            venueName: venueSnap.data()?.nameEn ?? venueId,
        }));
    });
    await dropVenueParking(venueId)
        .catch(err => console.error("deleteVenue: parking data not dropped for", venueId, err));
});
export const saveTeamMembers = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {teamMembers?: any[]};
    const members = Array.isArray(input.teamMembers) ? input.teamMembers : [];
    const validMembers = members.map(m => {
        const useAccountRole = Boolean(m.useAccountRole);
        const useAccountPhoto = Boolean(m.useAccountPhoto);
        const name = sanitizeDisplayText(validateStr(m.name, "name", 200, true));
        if (!name) throw new HttpsError("invalid-argument", "name is required.");
        const imageUrl = validateStr(m.imageUrl, "imageUrl", 500);
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
        const rosterSnap = await txn.get(rosterRef);
        const prevMembers = (rosterSnap.data()?.teamMembers ?? []) as {imageUrl?: string}[];
        await requireNewlyLinkedFilesExist(validMembers.map(m => m.imageUrl), prevMembers.map(m => m.imageUrl ?? ""));
        const stillReferenced = new Set(validMembers.map(m => m.imageUrl).filter(Boolean));
        const orphaned = [...new Set(
            prevMembers
                .map(m => m.imageUrl ?? "")
                .filter(url => url && !stillReferenced.has(url))
        )];

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
            ...performer(uid, callerSnap),
            configSections: ["team"],
        }));
        return orphaned;
    });

    await Promise.all(orphanedImages.map(url =>
        deleteStorageFile(url, ["team/"])
            .catch(logStorageCleanupError(`saveTeamMembers ${url}`))));
});

const GROUP_LABELS: Record<string, {en: string; zh: string}> = {
    "user": {en: "User", zh: "用户"},
    "staff": {en: "Staff", zh: "工作人员"},
    "core-staff": {en: "Core Staff", zh: "核心成员"},
    "president": {en: "President", zh: "社长"},
};

const accountEffectiveTitle = (acc: {group: string; title: string; titleCn: string}) => {
    const labels = GROUP_LABELS[acc.group] ?? {en: "", zh: ""};
    return {
        en: acc.title || acc.titleCn || labels.en,
        zh: acc.titleCn || acc.title || labels.zh,
    };
};

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
        const title = acc ? accountEffectiveTitle(acc) : {en: "", zh: ""};
        const role = (m.role as string) ?? "";
        const roleCn = (m.roleCn as string) ?? "";
        const imageUrl = (m.imageUrl as string) ?? "";
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

export const getTeamRoster = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireStaff(uid);

    const rosterSnap = await db.collection("teamRoster").doc("main").get();
    return {teamMembers: rosterSnap.data()?.teamMembers ?? []};
});

export const getSenderSettings = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireStaff(uid);
    return {domain: SENDER_DOMAIN, defaultPrefix: DEFAULT_SENDER_PREFIX};
});

export const getEmailQuotaStatus = onCall({
    maxInstances: 5,
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireStaff(uid);

    const usage = await syncProviderUsage();

    const [quota, queue, fromAddress] = await Promise.all([
        computeEmailQuotaDetail(),
        getScheduledMailQueueStatus(),
        getSenderAddress(),
    ]);

    const readingSource = usage !== null ? "live"
        : quota.observedAt !== null ? "cached"
            : "unavailable";

    return {
        provider: {
            name: EMAIL_PROVIDER.name,
            windowKind: EMAIL_PROVIDER.windowKind,
            fromAddress,
        },
        providerReported: readingSource === "unavailable" ? null : quota.confirmed,
        readingSource,
        usageTruncated: usage?.truncated ?? false,
        ...quota,
        ...queue,
        queueCap: RESEND_QUEUE_CAP,
        drainIntervalMinutes: DRAIN_INTERVAL_MINUTES,
        serverNow: new Date().toISOString(),
    };
});

export const getWalletPassStatus = onCall({
    maxInstances: 5,
    secrets: [WALLETWALLET_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireStaff(uid);

    const provider = await syncWalletUsage();
    const quota = await readWalletQuota();
    return {
        ...quota,
        provider,
        readingSource: provider !== null ? "live" : quota.observedAt !== null ? "cached" : "unavailable",
        serverNow: new Date().toISOString(),
    };
});
