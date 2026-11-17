import { randomUUID } from "crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import {
    WALLET_PASS_DAILY_CAP_PER_TICKET,
    WALLET_PASS_MONTHLY_CAP,
    WALLET_PASS_ORGANIZATION,
    WALLET_PASSES_ON,
} from "./config";
import { eventLocationText } from "./events";
import { db } from "./firebase";
import { isoOrNull } from "./helpers";
import { siteDay } from "./siteTime";
import { formatEventDateForEmail, ticketTypeStyle } from "./ticketEmail";
import { isApiOrder, type NewTicket, ticketClaimUrl } from "./tickets";

export const WALLETWALLET_API_KEY = defineSecret("WALLETWALLET_API_KEY");

const API_BASE = "https://api.walletwallet.dev";
const REQUEST_TIMEOUT_MS = 10_000;

function apiKey(): string {
    if (process.env.FUNCTIONS_EMULATOR === "true") return "";
    return WALLETWALLET_API_KEY.value();
}

const QUOTA_DOC = db.collection("system").doc("walletPassQuota");

const currentMonth = () => new Date().toISOString().slice(0, 7);

const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;

function parseQuota(data: FirebaseFirestore.DocumentData | undefined, month: string) {
    const used = data?.month === month ? count(data.used) : 0;
    const providerLimit = typeof data?.providerLimit === "number" && Number.isFinite(data.providerLimit)
        ? Math.max(0, data.providerLimit) : null;
    return {used, providerLimit};
}

const monthlyLimit = (providerLimit: number | null) =>
    providerLimit === null ? WALLET_PASS_MONTHLY_CAP : Math.min(WALLET_PASS_MONTHLY_CAP, providerLimit);

async function settlePasses(month: string, exhausted: boolean): Promise<void> {
    try {
        await db.runTransaction(async (txn) => {
            if (currentMonth() !== month) return;
            const {used, providerLimit} = parseQuota((await txn.get(QUOTA_DOC)).data(), month);
            txn.set(QUOTA_DOC, {
                month,
                used: exhausted ? Math.max(used, monthlyLimit(providerLimit)) : Math.max(0, used - 1),
            }, {merge: true});
        });
    } catch (err) {
        console.error("settlePasses: failed", err);
    }
}

interface WalletUsage {
    count: number;
    limit: number;
    remaining: number;
    resetDate: string;
    plan: string;
    trialExpiresAt: string | null;
}

async function fetchWalletUsage(): Promise<WalletUsage | null> {
    const key = apiKey();
    if (!key) return null;
    try {
        const resp = await fetch(`${API_BASE}/api/auth/usage`, {
            headers: {Authorization: `Bearer ${key}`},
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!resp.ok) {
            console.error(`fetchWalletUsage: ${resp.status} ${await resp.text().catch(() => "")}`);
            return null;
        }
        const json = await resp.json() as Record<string, unknown>;
        const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : null;
        const used = num(json.count);
        const limit = num(json.limit);
        if (used === null || limit === null) {
            console.error("fetchWalletUsage: unexpected response", json);
            return null;
        }
        return {
            count: used,
            limit,
            remaining: num(json.remaining) ?? Math.max(0, limit - used),
            resetDate: typeof json.resetDate === "string" ? json.resetDate : "",
            plan: typeof json.plan === "string" ? json.plan : "",
            trialExpiresAt: typeof json.trialExpiresAt === "string" ? json.trialExpiresAt : null,
        };
    } catch (err) {
        console.error("fetchWalletUsage: failed", err);
        return null;
    }
}

export async function syncWalletUsage(): Promise<WalletUsage | null> {
    const usage = await fetchWalletUsage();
    if (usage === null) return null;
    const month = currentMonth();
    try {
        await db.runTransaction(async (txn) => {
            const {used} = parseQuota((await txn.get(QUOTA_DOC)).data(), month);
            txn.set(QUOTA_DOC, {
                month,
                used: Math.max(used, usage.count),
                providerCount: usage.count,
                providerLimit: usage.limit,
                plan: usage.plan,
                resetDate: usage.resetDate,
                observedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
        });
    } catch (err) {
        console.error("syncWalletUsage: failed", err);
    }
    return usage;
}

export async function readWalletQuota() {
    const month = currentMonth();
    const data = (await QUOTA_DOC.get()).data();
    const {used, providerLimit} = parseQuota(data, month);
    return {
        configured: apiKey() !== "",
        month,
        used,
        cap: WALLET_PASS_MONTHLY_CAP,
        limit: monthlyLimit(providerLimit),
        perTicketDailyCap: WALLET_PASS_DAILY_CAP_PER_TICKET,
        observedAt: isoOrNull(data?.observedAt),
    };
}

const clip = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";

export const WALLET_COLORS = ["dark", "blue", "green", "red", "purple", "orange"] as const;
type WalletColor = typeof WALLET_COLORS[number];
export const WALLET_PASS_MAX_NOTES = 4;
const WALLET_PASS_TOP_TEXT = "Sekai Beyond";

interface WalletPassSettings {
    enabled: boolean;
    color: "auto" | WalletColor;
    headerText: string;
    notes: {label: string; value: string}[];
}

export const walletPassSettingsRef = (eventRef: FirebaseFirestore.DocumentReference) =>
    eventRef.collection("settings").doc("walletPass");

function parseWalletPassSettings(raw: FirebaseFirestore.DocumentData | undefined): WalletPassSettings {
    const notes: unknown[] = Array.isArray(raw?.notes) ? raw.notes : [];
    return {
        enabled: raw?.enabled !== false,
        color: (WALLET_COLORS as readonly unknown[]).includes(raw?.color) ? raw!.color : "auto",
        headerText: str(raw?.headerText),
        notes: notes
            .map(n => ({label: str((n as any)?.label), value: str((n as any)?.value)}))
            .filter(n => n.value)
            .slice(0, WALLET_PASS_MAX_NOTES),
    };
}

export async function countWalletPasses(eventRef: FirebaseFirestore.DocumentReference, delta: number): Promise<void> {
    if (delta === 0) return;
    await walletPassSettingsRef(eventRef).set({passCount: FieldValue.increment(delta)}, {merge: true})
        .catch(err => console.error(`countWalletPasses: ${eventRef.id} by ${delta} failed`, err));
}

export async function walletPassesOnFor(eventRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
    if (!WALLET_PASSES_ON) return false;
    try {
        return parseWalletPassSettings((await walletPassSettingsRef(eventRef).get()).data()).enabled;
    } catch (err) {
        console.error(`walletPassesOnFor: ${eventRef.id}'s settings couldn't be read`, err);
        return true;
    }
}

async function eventLocation(data: FirebaseFirestore.DocumentData): Promise<string> {
    const venueId = str(data.venueId);
    const venue = venueId
        ? (await db.collection("venues").doc(venueId).get().catch(() => null))?.data()
        : undefined;
    return eventLocationText(data, venue, true) || eventLocationText(data, venue, false);
}

function passBody(
    event: {id: string; data: FirebaseFirestore.DocumentData},
    ticket: Partial<NewTicket>,
    contactEmail: string,
    location: string,
    settings: WalletPassSettings,
) {
    const id = ticket.ticketId ?? "";
    const {label, walletColor, walletLabel} = ticketTypeStyle(ticket);
    const titleCn = str(event.data.titleCn);
    const title = str(event.data.title) || titleCn || "Event";
    const date = formatEventDateForEmail(event.data.startAt);
    const endAt: number | undefined = event.data.endAt?.toMillis?.();
    const field = (fieldLabel: string, value: string) => ({label: fieldLabel, value: clip(value, 256)});
    return {
        organizationName: clip(WALLET_PASS_ORGANIZATION, 64),
        logoText: clip(WALLET_PASS_TOP_TEXT, 64),
        description: clip(`${title} ticket`, 128),
        headerFields: [field("Ticket", walletLabel)],
        primaryFields: [field("Event", title)],
        secondaryFields: [
            ...(date ? [field("Date", date)] : []),
            ...(location ? [field("Location", location)] : []),
        ],
        backFields: [
            field("Ticket ID", id),
            field("Ticket Type", label),
            ...(contactEmail ? [field("Questions", contactEmail)] : []),
            ...settings.notes.map(n => ({label: clip(n.label, 64), value: clip(n.value, 256)})),
        ],
        barcodeValue: ticketClaimUrl(id, event.id),
        barcodeFormat: "QR",
        barcodeAltText: "",
        colorPreset: settings.color === "auto" ? walletColor : settings.color,
        ...(endAt && endAt > Date.now()
            ? {expirationDate: new Date(endAt).toISOString().replace(/\.\d{3}Z$/, "Z")}
            : {}),
    };
}

type CreateOutcome =
    | {kind: "made"; serial: string; shareUrl: string}
    | {kind: "refused"; status: number}
    | {kind: "unknown"};

async function createPass(key: string, body: object): Promise<CreateOutcome> {
    let resp: Response;
    try {
        resp = await fetch(`${API_BASE}/api/passes?format=json`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        console.error("createPass: no answer", err);
        return {kind: "unknown"};
    }
    if (!resp.ok) {
        console.error(`createPass: ${resp.status} ${await resp.text().catch(() => "")}`);
        return resp.status < 500 ? {kind: "refused", status: resp.status} : {kind: "unknown"};
    }
    const json: any = await resp.json().catch(() => null);
    const serial = json?.serialNumber ?? resp.headers.get("x-serial-number");
    const shareUrl = json?.shareUrl ?? resp.headers.get("x-pass-url");
    if (typeof serial !== "string" || !serial || typeof shareUrl !== "string" || !shareUrl.startsWith("https://")) {
        console.error("createPass: made, but its response couldn't be read", json);
        return {kind: "unknown"};
    }
    return {kind: "made", serial, shareUrl};
}

export type WalletPassRefusal =
    | "off"
    | "not-found"
    | "voided"
    | "ended"
    | "ticket-limit"
    | "month-limit"
    | "failed";

const CLAIM_TTL_MS = 30_000;
const CLAIM_WAIT_MS = 15_000;
const CLAIM_POLL_MS = 500;

export async function walletPassFor(
    eventId: string,
    ticketId: string,
): Promise<{shareUrl: string} | {refusal: WalletPassRefusal}> {
    const key = apiKey();
    if (!key || !WALLET_PASSES_ON) return {refusal: "off"};

    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const month = currentMonth();
    const day = siteDay(Date.now());
    const claimId = randomUUID();
    type Claim = {shareUrl: string} | {refusal: WalletPassRefusal} | {waitOn: FirebaseFirestore.DocumentReference} | {
        ref: FirebaseFirestore.DocumentReference;
        ticket: Partial<NewTicket>;
        event: {id: string; data: FirebaseFirestore.DocumentData};
        settings: WalletPassSettings;
    };
    let claim: Claim;
    try {
        claim = await db.runTransaction<Claim>(async (txn) => {
            const eventSnap = await txn.get(eventRef);
            const attendees = await txn.get(
                eventRef.collection("attendees").where("ticketIds", "array-contains", ticketId).limit(1));
            const quotaSnap = await txn.get(QUOTA_DOC);
            const settingsSnap = await txn.get(walletPassSettingsRef(eventRef));
            const attendee = attendees.docs[0];
            const data = attendee?.data();
            const ticket = (data?.tickets as Partial<NewTicket>[] | undefined)?.find(t => t?.ticketId === ticketId);
            if (!eventSnap.exists || !ticket || data!.source === "hometown"
                || (isApiOrder(data) && data!.apiSendEmail !== true)) {
                return {refusal: "not-found"};
            }
            if (ticket.voided) return {refusal: "voided"};
            const settings = parseWalletPassSettings(settingsSnap.data());
            if (!settings.enabled) return {refusal: "off"};
            const endAt: number | undefined = eventSnap.data()!.endAt?.toMillis?.();
            if (endAt !== undefined && endAt <= Date.now()) return {refusal: "ended"};

            const kept = data!.walletPasses?.[ticketId];
            if (typeof kept?.shareUrl === "string" && kept.shareUrl) return {shareUrl: kept.shareUrl};
            const claimedAt: number | undefined = kept?.claimedAt?.toMillis?.();
            if (claimedAt !== undefined && Date.now() - claimedAt < CLAIM_TTL_MS) return {waitOn: attendee.ref};

            const daily = data!.walletPassDaily?.[ticketId];
            const madeToday = daily?.day === day ? count(daily.made) : 0;
            if (madeToday >= WALLET_PASS_DAILY_CAP_PER_TICKET) return {refusal: "ticket-limit"};
            const {used, providerLimit} = parseQuota(quotaSnap.data(), month);
            if (used >= monthlyLimit(providerLimit)) return {refusal: "month-limit"};

            txn.set(QUOTA_DOC, {month, used: used + 1}, {merge: true});
            txn.update(attendee.ref,
                new FieldPath("walletPassDaily", ticketId), {day, made: madeToday + 1},
                new FieldPath("walletPasses", ticketId), {claim: claimId, claimedAt: Timestamp.now()});
            return {ref: attendee.ref, ticket, event: {id: eventId, data: eventSnap.data()!}, settings};
        });
    } catch (err) {
        console.error(`walletPassFor: ${eventId}/${ticketId} couldn't be read`, err);
        return {refusal: "failed"};
    }
    if ("waitOn" in claim) return awaitClaim(claim.waitOn, ticketId);
    if (!("ref" in claim)) return claim;

    const [contactEmail, location] = await Promise.all([
        db.collection("config").doc("main").get().then(s => str(s.get("contactEmail")), () => ""),
        eventLocation(claim.event.data),
    ]);
    const outcome = await createPass(key, passBody(claim.event, claim.ticket, contactEmail, location, claim.settings));
    if (outcome.kind === "made") {
        await Promise.all([
            claim.ref.update(new FieldPath("walletPasses", ticketId),
                {serial: outcome.serial, shareUrl: outcome.shareUrl, createdAt: FieldValue.serverTimestamp()})
                .catch(err => console.error(`walletPassFor: made ${outcome.serial}, but failed to keep it`, err)),
            countWalletPasses(eventRef, 1),
        ]);
        return {shareUrl: outcome.shareUrl};
    }
    const refused = outcome.kind === "refused";
    await Promise.all([
        letClaimGo(claim.ref, ticketId, claimId, refused),
        refused ? settlePasses(month, outcome.status === 429) : null,
    ]);
    return refused && outcome.status === 429 ? {refusal: "month-limit"} : {refusal: "failed"};
}

async function letClaimGo(
    ref: FirebaseFirestore.DocumentReference,
    ticketId: string,
    claimId: string,
    giveBack: boolean,
): Promise<void> {
    try {
        await db.runTransaction(async (txn) => {
            const data = (await txn.get(ref)).data();
            if (!data) return;
            const changes: unknown[] = [];
            if (data.walletPasses?.[ticketId]?.claim === claimId) {
                changes.push(new FieldPath("walletPasses", ticketId), FieldValue.delete());
            }
            if (giveBack) changes.push(new FieldPath("walletPassDaily", ticketId, "made"), FieldValue.increment(-1));
            if (changes.length > 0) txn.update(ref, changes[0] as FieldPath, changes[1], ...changes.slice(2));
        });
    } catch (err) {
        console.error(`letClaimGo: failed for ${ticketId}`, err);
    }
}

async function awaitClaim(
    ref: FirebaseFirestore.DocumentReference,
    ticketId: string,
): Promise<{shareUrl: string} | {refusal: WalletPassRefusal}> {
    const deadline = Date.now() + CLAIM_WAIT_MS;
    while (Date.now() < deadline) {
        await sleep(CLAIM_POLL_MS);
        const entry = (await ref.get().catch(() => null))?.get(new FieldPath("walletPasses", ticketId));
        if (typeof entry?.shareUrl === "string" && entry.shareUrl) return {shareUrl: entry.shareUrl};
        if (!entry?.claimedAt) break;
    }
    return {refusal: "failed"};
}

async function revokePass(key: string, serial: string): Promise<boolean> {
    try {
        const resp = await fetch(`${API_BASE}/api/passes/${encodeURIComponent(serial)}`, {
            method: "DELETE",
            headers: {Authorization: `Bearer ${key}`},
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (resp.ok || resp.status === 404) return true;
        console.error(`revokePass: ${resp.status} ${await resp.text().catch(() => "")}`);
    } catch (err) {
        console.error("revokePass: failed", err);
    }
    return false;
}

export async function revokeWalletPasses(walletPasses: unknown, ticketIds: string[]): Promise<string[]> {
    const key = apiKey();
    if (!key || !walletPasses || typeof walletPasses !== "object") return [];
    const kept = walletPasses as Record<string, {serial?: unknown} | undefined>;
    const revoked = await Promise.all(ticketIds.map(async (id) => {
        const serial = kept[id]?.serial;
        return typeof serial === "string" && serial && await revokePass(key, serial) ? id : null;
    }));
    return revoked.filter((id): id is string => id !== null);
}

const REVOKE_CONCURRENCY = 8;

export async function revokeEventWalletPasses(attendees: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<number> {
    const key = apiKey();
    if (!key) return 0;
    const serials = attendees.flatMap(a => Object.values(a.get("walletPasses") ?? {})
        .map(p => (p as {serial?: unknown})?.serial)
        .filter((serial): serial is string => typeof serial === "string" && serial !== ""));
    let next = 0;
    let revoked = 0;
    const worker = async () => {
        while (next < serials.length) {
            if (await revokePass(key, serials[next++])) revoked++;
        }
    };
    await Promise.all(Array.from({length: Math.min(REVOKE_CONCURRENCY, serials.length)}, worker));
    return revoked;
}
