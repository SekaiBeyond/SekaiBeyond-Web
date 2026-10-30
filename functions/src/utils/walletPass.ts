import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import {
    WALLET_PASS_DAILY_CAP_PER_TICKET,
    WALLET_PASS_MONTHLY_CAP,
    WALLET_PASS_ORGANIZATION,
    WALLET_PASSES_ON,
} from "./config";
import { db } from "./firebase";
import { siteDay } from "./siteTime";
import { formatEventDateForEmail, ticketIdOf, ticketTypeStyle } from "./ticketEmail";
import { isApiOrder, ticketClaimUrl } from "./tickets";

/**
 * Apple and Google Wallet passes for emailed tickets, made by WalletWallet
 * (walletwallet.dev) under its own signing identity. A pass's barcode holds
 * the same claim URL as the email's QR code, so the door scanner reads either.
 *
 * Every ticket in a ticket email links serveWalletPass (walletPassUrl), and a
 * pass is made the first time that link is opened (walletPassFor). It's kept on
 * the attendee doc as walletPasses.<ticketId> ({serial, shareUrl, createdAt}),
 * so opening the link again goes to the same pass. A ticket makes at most
 * WALLET_PASS_DAILY_CAP_PER_TICKET passes a day (walletPassDaily.<ticketId>,
 * {day, made}), which only comes into play when its pass can't be reused: once
 * revoked, or when one was made but couldn't be kept.
 */

// Bind to functions that make or revoke passes. Without the binding, value()
// returns "", and passes are off.
export const WALLETWALLET_API_KEY = defineSecret("WALLETWALLET_API_KEY");

const API_BASE = "https://api.walletwallet.dev";
const REQUEST_TIMEOUT_MS = 10_000;

// The emulator never reaches WalletWallet, whatever key it has, as it never
// reaches Resend: passes are off there.
function apiKey(): string {
    if (process.env.FUNCTIONS_EMULATOR === "true") return "";
    return WALLETWALLET_API_KEY.value();
}

// This month's passes (system/walletPassQuota). WalletWallet counts by calendar
// month in UTC, resetting on the 1st; every pass made counts, and revoking one
// doesn't give it back.
//
// `used` is this month's count, passes in flight included: walletPassFor adds
// one before making a pass, settlePasses gives back one certainly not made.
// syncWalletUsage raises it to WalletWallet's own count, which covers passes
// made elsewhere on the account, but never lowers it, since a pass still in
// flight isn't in that count yet. A new month starts it at zero.
const QUOTA_DOC = db.collection("system").doc("walletPassQuota");

const currentMonth = () => new Date().toISOString().slice(0, 7);

const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;

function parseQuota(data: FirebaseFirestore.DocumentData | undefined, month: string) {
    const used = data?.month === month ? count(data.used) : 0;
    const providerLimit = typeof data?.providerLimit === "number" && Number.isFinite(data.providerLimit)
        ? Math.max(0, data.providerLimit) : null;
    return {used, providerLimit};
}

// WALLET_PASS_MONTHLY_CAP, or the plan's limit once read when that's lower.
const monthlyLimit = (providerLimit: number | null) =>
    providerLimit === null ? WALLET_PASS_MONTHLY_CAP : Math.min(WALLET_PASS_MONTHLY_CAP, providerLimit);

// Gives back one of `month`'s passes, or, with `exhausted`, spends the rest of
// the month's allowance: WalletWallet has said it's used up. Nothing once the
// month has turned. Errors are logged and swallowed.
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

/** WalletWallet's own count for the account this month (GET /api/auth/usage). */
export interface WalletUsage {
    count: number;
    limit: number;
    remaining: number;
    /** The day the count resets, as WalletWallet gives it ("2026-11-01"). */
    resetDate: string;
    plan: string;
    trialExpiresAt: string | null;
}

// Null means unknown: passes off (no key, or the emulator), or the request
// failed.
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

/**
 * Reads WalletWallet's count into the cache, so the cap covers passes made
 * outside this site and follows the plan's limit, and returns it. A null
 * reading leaves the cache as it is.
 */
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

/** The cache as the caps read it, for the Wallet Passes tool. */
export async function readWalletQuota() {
    const month = currentMonth();
    const data = (await QUOTA_DOC.get()).data();
    const {used, providerLimit} = parseQuota(data, month);
    const observedAt: string | null = data?.observedAt?.toDate?.()?.toISOString?.() ?? null;
    return {
        configured: apiKey() !== "",
        month,
        used,
        cap: WALLET_PASS_MONTHLY_CAP,
        limit: monthlyLimit(providerLimit),
        perTicketDailyCap: WALLET_PASS_DAILY_CAP_PER_TICKET,
        observedAt,
    };
}

const clip = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";

// One ticket's pass, from what WalletWallet's free plan takes: no images or
// custom colours, so a colour preset by ticket type. The holder's name and
// email stay out of it; WalletWallet gets the event and the ticket only.
function passBody(event: {id: string; data: FirebaseFirestore.DocumentData}, ticket: any, contactEmail: string) {
    const id = ticketIdOf(ticket);
    const {label, walletColor} = ticketTypeStyle(ticket);
    const titleCn = str(event.data.titleCn);
    const title = str(event.data.title) || titleCn || "Event";
    const date = formatEventDateForEmail(event.data.startAt);
    const location = str(event.data.location) || str(event.data.locationCn);
    const endAt: number | undefined = event.data.endAt?.toMillis?.();
    const field = (fieldLabel: string, value: string) => ({label: fieldLabel, value: clip(value, 256)});
    return {
        organizationName: clip(WALLET_PASS_ORGANIZATION, 64),
        logoText: clip(WALLET_PASS_ORGANIZATION, 64),
        description: clip(`${title} ticket`, 128),
        headerFields: [field("Ticket", label)],
        primaryFields: [field("Event", title)],
        secondaryFields: [
            ...(date ? [field("Date", date)] : []),
            ...(location ? [field("Location", location)] : []),
        ],
        backFields: [
            field("Ticket ID", id),
            ...(titleCn && titleCn !== title ? [field("活动", titleCn)] : []),
            ...(contactEmail ? [field("Questions", contactEmail)] : []),
        ],
        barcodeValue: ticketClaimUrl(id, event.id),
        barcodeFormat: "QR",
        barcodeAltText: id,
        colorPreset: walletColor,
        // Greyed out once the event is over. RFC 3339, without milliseconds as
        // WalletWallet's examples have it.
        ...(endAt && endAt > Date.now()
            ? {expirationDate: new Date(endAt).toISOString().replace(/\.\d{3}Z$/, "Z")}
            : {}),
    };
}

type CreateOutcome =
    | {kind: "made"; serial: string; shareUrl: string}
    // WalletWallet answered with a 4xx, so nothing was made or counted.
    | {kind: "refused"; status: number}
    // No answer, a 5xx, or one that couldn't be read: it may have been made.
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
    // The .pkpass form carries both in headers instead; its docs disagree on
    // which form is the default.
    const serial = json?.serialNumber ?? resp.headers.get("x-serial-number");
    const shareUrl = json?.shareUrl ?? resp.headers.get("x-pass-url");
    if (typeof serial !== "string" || !serial || typeof shareUrl !== "string" || !shareUrl.startsWith("https://")) {
        console.error("createPass: made, but its response couldn't be read", json);
        return {kind: "unknown"};
    }
    return {kind: "made", serial, shareUrl};
}

/** Why walletPassFor has no pass to give. */
export type WalletPassRefusal =
    | "off"
    | "not-found"
    | "voided"
    | "ended"
    | "ticket-limit"
    | "month-limit"
    | "failed";

/**
 * The share link of a ticket's wallet pass: its kept one, or one made now while
 * the ticket's daily cap and the month's allowance allow. Never throws.
 *
 * The ticket and both caps are checked and charged in one transaction, so two
 * opens at once can't both spend the last of either. A pass made but not
 * answered for stays charged, as WalletWallet may have counted it.
 */
export async function walletPassFor(
    eventId: string,
    ticketId: string,
): Promise<{shareUrl: string} | {refusal: WalletPassRefusal}> {
    const key = apiKey();
    if (!key || !WALLET_PASSES_ON) return {refusal: "off"};

    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const month = currentMonth();
    const day = siteDay(Date.now());
    // Done in the transaction, or one pass claimed there for this ticket.
    type Claim = {shareUrl: string} | {refusal: WalletPassRefusal} | {
        ref: FirebaseFirestore.DocumentReference;
        ticket: any;
        event: {id: string; data: FirebaseFirestore.DocumentData};
    };
    let claim: Claim;
    try {
        claim = await db.runTransaction<Claim>(async (txn) => {
            const [eventSnap, attendees, quotaSnap] = await Promise.all([
                txn.get(eventRef),
                txn.get(eventRef.collection("attendees").where("ticketIds", "array-contains", ticketId).limit(1)),
                txn.get(QUOTA_DOC),
            ]);
            const attendee = attendees.docs[0];
            const data = attendee?.data();
            const ticket = (data?.tickets as any[] | undefined)?.find(t => ticketIdOf(t) === ticketId);
            // Only tickets this site emails, whose emails are what link here. An
            // archived event's are gone from upcomingEvents.
            if (!eventSnap.exists || !ticket || data!.source === "hometown"
                || (isApiOrder(data) && data!.apiSendEmail !== true)) {
                return {refusal: "not-found"};
            }
            if (ticket.voided) return {refusal: "voided"};
            const endAt: number | undefined = eventSnap.data()!.endAt?.toMillis?.();
            if (endAt !== undefined && endAt <= Date.now()) return {refusal: "ended"};

            const kept = data!.walletPasses?.[ticketId]?.shareUrl;
            if (typeof kept === "string" && kept) return {shareUrl: kept};

            const daily = data!.walletPassDaily?.[ticketId];
            const madeToday = daily?.day === day ? count(daily.made) : 0;
            if (madeToday >= WALLET_PASS_DAILY_CAP_PER_TICKET) return {refusal: "ticket-limit"};
            const {used, providerLimit} = parseQuota(quotaSnap.data(), month);
            if (used >= monthlyLimit(providerLimit)) return {refusal: "month-limit"};

            txn.set(QUOTA_DOC, {month, used: used + 1}, {merge: true});
            txn.update(attendee.ref, new FieldPath("walletPassDaily", ticketId), {day, made: madeToday + 1});
            return {ref: attendee.ref, ticket, event: {id: eventId, data: eventSnap.data()!}};
        });
    } catch (err) {
        console.error(`walletPassFor: ${eventId}/${ticketId} couldn't be read`, err);
        return {refusal: "failed"};
    }
    if (!("ref" in claim)) return claim;

    // Site Config's contact address, for the back of the pass.
    const contactEmail = await db.collection("config").doc("main").get()
        .then(s => str(s.get("contactEmail")), () => "");
    const outcome = await createPass(key, passBody(claim.event, claim.ticket, contactEmail));
    if (outcome.kind === "made") {
        await claim.ref.update(new FieldPath("walletPasses", ticketId),
            {serial: outcome.serial, shareUrl: outcome.shareUrl, createdAt: FieldValue.serverTimestamp()})
            .catch(err => console.error(`walletPassFor: made ${outcome.serial}, but failed to keep it`, err));
        return {shareUrl: outcome.shareUrl};
    }
    if (outcome.kind === "refused") {
        // Not made, so neither cap is spent.
        await Promise.all([
            settlePasses(month, outcome.status === 429),
            claim.ref.update(new FieldPath("walletPassDaily", ticketId, "made"), FieldValue.increment(-1))
                .catch(err => console.error("walletPassFor: failed to give back the ticket's pass", err)),
        ]);
        if (outcome.status === 429) return {refusal: "month-limit"};
    }
    return {refusal: "failed"};
}

// Marks a pass invalid in every wallet holding it. True once WalletWallet has
// no live pass by that serial: revoked now, before, or never known to it.
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

/**
 * Revokes the passes of `ticketIds` kept in `walletPasses` (an attendee doc's
 * field), returning the IDs whose pass is gone, for the caller to drop. One
 * that fails stays valid, as the email's QR code does; check-in turns a voided
 * ticket away either way. Never throws.
 */
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
