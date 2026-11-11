import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, consumeRateLimit, normalizeGroup, requireAuth, type UserGroup } from "../utils/auth";
import { deletionPending } from "../utils/deletion";
import { getEventDoc } from "../utils/events";
import { db } from "../utils/firebase";
import { MANAGER_ORIGIN, managerConfigured, mintManagerToken, verifyManagerIdToken } from "../utils/manager";
import { signedInSinceSessionsEnded } from "../utils/sessions";

/**
 * SKBY Manager's way in (see utils/manager.ts):
 *
 *   issueManagerToken           callable, from the /manager-sign-in page
 *   GET /api/manager/v1/me      the caller
 *   GET /api/manager/v1/team    staff, core staff and the president
 *   GET /api/manager/v1/events  every event, for linking a project to one
 *   GET /api/manager/v1/events/{eventId}/staff
 *
 * The API takes the manager's own ID token, from a sign-in issueManagerToken
 * made, and is for its page alone (CORS). Everyone it lists is shown by name,
 * photo, group and title, never email.
 */

/** Whether a user doc's account may use the manager: core staff and the president, unless it's being deleted. */
function hasManagerAccess(data: FirebaseFirestore.DocumentData | undefined): boolean {
    return !!data && ADMIN_GROUPS.includes(data.group) && !deletionPending(data);
}

/**
 * A sign-in for the manager's project, and the manager page to hand it to,
 * which the /manager-sign-in page does with the `state` the manager sent it
 * there with. The address comes from here, never from the link, so a sign-in
 * can't be sent anywhere else.
 */
export const issueManagerToken = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    if (!managerConfigured) {
        throw new HttpsError("failed-precondition", "SKBY Manager isn't set up on this site.", {code: "manager-off"});
    }
    const data = (await db.collection("users").doc(uid).get()).data();
    if (!hasManagerAccess(data)) {
        throw new HttpsError("permission-denied", "SKBY Manager is for core staff only.",
            {code: "manager-not-allowed"});
    }
    const token = await mintManagerToken(uid, normalizeGroup(data!.group));
    return {token, returnUrl: `${MANAGER_ORIGIN}/`};
});

/** Calls one person may make a minute. Opening the manager makes a few. */
const MANAGER_RATE_LIMIT_MAX = 60;

const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Firestore keeps IDs like __x__ for itself and refuses to read one, so no event has one. */
const RESERVED_ID_RE = /^__.*__$/;

/** The groups /team lists, and the order it lists them in. */
const TEAM_GROUPS: UserGroup[] = ["president", "core-staff", "staff"];

/** The user doc fields a person is shown with, and all that's read of one. */
const PERSON_FIELDS = ["displayName", "photoURL", "group", "title", "titleCn"];

class ManagerApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

const str = (v: unknown): string => typeof v === "string" ? v : "";
const iso = (t: unknown): string | null => t instanceof Timestamp ? t.toDate().toISOString() : null;

interface Person {
    uid: string;
    displayName: string;
    photoURL: string;
    group: UserGroup;
    title: string;
    titleCn: string;
}

function personJson(snap: FirebaseFirestore.DocumentSnapshot): Person {
    const data = snap.data() ?? {};
    return {
        uid: snap.id,
        displayName: str(data.displayName),
        photoURL: str(data.photoURL),
        group: normalizeGroup(data.group),
        title: str(data.title),
        titleCn: str(data.titleCn),
    };
}

/** Highest group first, then by name. */
function byGroupThenName(a: Person, b: Person): number {
    const rank = (p: Person) => {
        const i = TEAM_GROUPS.indexOf(p.group);
        return i === -1 ? TEAM_GROUPS.length : i;
    };
    return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName) || (a.uid < b.uid ? -1 : 1);
}

/**
 * The caller's user doc, from the manager's ID token in `header`. Only a
 * sign-in issueManagerToken made will do, not one of the manager's own
 * accounts, and only while `accessUntil` lasts. Whether the account may still
 * use the manager is read now, not from the token, so losing access here ends
 * it here at once, as signing out everywhere does.
 */
async function authenticate(header: string | undefined): Promise<FirebaseFirestore.DocumentSnapshot> {
    const match = /^Bearer\s+(\S{1,4096})$/i.exec(header ?? "");
    if (!match) {
        throw new ManagerApiError(401, "missing-token", "Send the manager's ID token as \"Authorization: Bearer <token>\".");
    }
    const signInAgain = new ManagerApiError(401, "invalid-token", "Sign in to SKBY Manager again.");
    let token: DecodedIdToken;
    try {
        token = await verifyManagerIdToken(match[1]);
    } catch {
        throw signInAgain;
    }
    if (token.firebase?.sign_in_provider !== "custom" || typeof token.accessUntil !== "number") throw signInAgain;
    if (token.accessUntil <= Date.now()) {
        throw new ManagerApiError(401, "session-expired", "This sign-in has expired. Sign in to SKBY Manager again.");
    }

    await consumeRateLimit(`manager_${token.uid}`, MANAGER_RATE_LIMIT_MAX);
    const snap = await db.collection("users").doc(token.uid).get();
    if (!snap.exists || !signedInSinceSessionsEnded(token, snap.data())) {
        throw new ManagerApiError(401, "session-ended", "This sign-in has been signed out. Sign in to SKBY Manager again.");
    }
    if (!hasManagerAccess(snap.data())) {
        throw new ManagerApiError(403, "not-allowed", "SKBY Manager is for core staff only.");
    }
    return snap;
}

async function listTeam() {
    const snap = await db.collection("users").where("group", "in", TEAM_GROUPS).select(...PERSON_FIELDS).get();
    return {people: snap.docs.map(personJson).sort(byGroupThenName)};
}

/** An event as far as the manager needs it: what to call it and when it is. */
function eventJson(snap: FirebaseFirestore.DocumentSnapshot, archived: boolean) {
    const data = snap.data() ?? {};
    return {
        id: snap.id,
        archived,
        published: data.published === true,
        title: str(data.title),
        titleCn: str(data.titleCn),
        // Unarchived events have these.
        startAt: iso(data.startAt),
        endAt: iso(data.endAt),
        // Archived ones have this instead, as YYYY-MM-DD.
        date: typeof data.date === "string" ? data.date : null,
    };
}

/**
 * Every event, published or not, in the site's own order: unarchived soonest
 * first, then archived latest first. Archiving keeps an event's ID, so a
 * project linked to one stays linked.
 */
async function listEvents() {
    const fields = ["title", "titleCn", "published", "startAt", "endAt", "date"];
    const [upcoming, past] = await Promise.all([
        db.collection("upcomingEvents").orderBy("startAt", "asc").select(...fields).get(),
        db.collection("pastEvents").orderBy("date", "desc").select(...fields).get(),
    ]);
    return {
        events: [
            ...upcoming.docs.map(snap => eventJson(snap, false)),
            ...past.docs.map(snap => eventJson(snap, true)),
        ],
    };
}

/** An event's staff, as its Event Staff section lists them. Kept on archive, like the event's ID. */
async function listEventStaff(eventId: string) {
    const notFound = new ManagerApiError(404, "event-not-found", "Event not found.");
    if (RESERVED_ID_RE.test(eventId)) throw notFound;
    if (!(await getEventDoc(eventId)).snap.exists) throw notFound;
    const snap = await db.collection("users")
        .where("eventStaffEvents", "array-contains", eventId)
        .select(...PERSON_FIELDS)
        .get();
    return {eventId, staff: snap.docs.map(personJson).sort(byGroupThenName)};
}

type Route =
    | {kind: "me"}
    | {kind: "team"}
    | {kind: "events"}
    | {kind: "event-staff"; eventId: string};

/**
 * Served at /api/manager/v1/* through the Hosting rewrite and at /v1/* on the
 * function's own URL, so either prefix.
 */
function matchRoute(path: string): Route | null {
    const segments = path.replace(/^\/api\/manager(?=\/)/, "").split("/").filter(Boolean);
    if (segments[0] !== "v1") return null;
    const rest = segments.slice(1);
    if (rest.length === 1 && rest[0] === "me") return {kind: "me"};
    if (rest.length === 1 && rest[0] === "team") return {kind: "team"};
    if (rest.length === 1 && rest[0] === "events") return {kind: "events"};
    if (rest.length === 3 && rest[0] === "events" && rest[2] === "staff" && EVENT_ID_RE.test(rest[1])) {
        return {kind: "event-staff", eventId: rest[1]};
    }
    return null;
}

// cors: false leaves CORS to the handler, in the emulator too, which otherwise
// answers every preflight itself, for any origin.
export const managerApi = onRequest({maxInstances: 10, memory: "256MiB", cors: false}, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const fail = (status: number, code: string, message: string) =>
        res.status(status).json({error: {code, message}});

    // Not there at all until the manager is set up.
    if (!managerConfigured) {
        fail(404, "not-found", "No such endpoint.");
        return;
    }
    // Only the manager's page may read an answer in a browser. Callers without
    // one, such as a script, need the same token.
    res.set("Vary", "Origin");
    if (req.get("Origin") === MANAGER_ORIGIN) res.set("Access-Control-Allow-Origin", MANAGER_ORIGIN);
    if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET");
        res.set("Access-Control-Allow-Headers", "Authorization");
        res.set("Access-Control-Max-Age", "3600");
        res.status(204).end();
        return;
    }

    const route = matchRoute(req.path);
    if (!route) {
        fail(404, "not-found", "No such endpoint.");
        return;
    }
    if (req.method !== "GET") {
        res.set("Allow", "GET");
        fail(405, "method-not-allowed", "Use GET here.");
        return;
    }

    try {
        const caller = await authenticate(req.get("Authorization"));
        const body = route.kind === "me" ? personJson(caller)
            : route.kind === "team" ? await listTeam()
                : route.kind === "events" ? await listEvents()
                    : await listEventStaff(route.eventId);
        res.status(200).json(body);
    } catch (err) {
        if (err instanceof ManagerApiError) {
            fail(err.status, err.code, err.message);
            return;
        }
        // consumeRateLimit's.
        if (err instanceof HttpsError && err.code === "resource-exhausted") {
            const retryAfterMs = (err.details as {retryAfterMs?: number} | undefined)?.retryAfterMs;
            if (retryAfterMs) res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
            fail(429, "rate-limited", err.message);
            return;
        }
        console.error(`[managerApi] ${req.method} ${req.path} failed`, err);
        fail(500, "internal", "Something went wrong. Try again.");
    }
});
