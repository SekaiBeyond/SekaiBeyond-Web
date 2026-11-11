// SKBY Manager's sign-in and API, run inside the emulators by scripts/manager-test.ts (npm run test:manager), with
// the manager set up when MANAGER_PROJECT_ID is set and not otherwise. Not run on its own: it needs the emulators'
// environment, and it seeds the demo-test project as it goes.
//
// The manager's project lives in the same Auth emulator as a second project. Manager ID tokens are unsigned, as the
// emulator's are, and made here; its users have to exist there, as the Admin SDK's verifyIdToken looks them up
// under the emulator, revocation included.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, test } from "node:test";

// From the functions' own dependencies, which the site doesn't have.
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const PROJECT = "demo-test";
const MANAGER = process.env.MANAGER_PROJECT_ID;
const ORIGIN = process.env.MANAGER_ORIGIN;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();
const managerAuth = MANAGER ? getAuth(initializeApp({ projectId: MANAGER }, "manager")) : null;

/** When a manager user's sign-ins were last revoked. */
const validSince = async (uid) => (await managerAuth.getUser(uid)).tokensValidAfterTime;
/** Auth times are whole seconds, so a revoke or sign-in after this is told apart from one before. */
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

/** An ID token for the manager's project, shaped as one from a sign-in issueManagerToken made. */
function managerIdToken(uid, { provider = "custom", accessUntil, mintedAt, authTime } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${MANAGER}`,
    aud: MANAGER,
    auth_time: authTime ?? now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: provider },
    group: "core-staff",
    mintedAt: mintedAt ?? Date.now(),
    accessUntil: accessUntil ?? Date.now() + 86_400_000,
  })}.`;
}

/** An ID token for this site, signed in through the Auth emulator as the site's sign-ins are. */
async function siteIdToken(uid) {
  const custom = await auth.createCustomToken(uid, { mintedAt: Date.now() });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const body = await res.json();
  assert.ok(body.idToken, JSON.stringify(body));
  return body.idToken;
}

async function callable(name, idToken, data = {}) {
  const res = await fetch(`${FN}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.json() };
}

async function api(path, { token, method = "GET", origin = ORIGIN, headers = {} } = {}) {
  const res = await fetch(`${FN}/managerApi${path}`, {
    method,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

describe("SKBY Manager set up", { skip: !MANAGER }, () => {
  before(async () => {
    const now = Date.now();
    await Promise.all([
      db.doc("users/coreA").set({ group: "core-staff", displayName: "Core A", email: "a@example.com", photoURL: "https://img/a", title: "Lead", titleCn: "负责人", eventStaffEvents: ["ev1"] }),
      db.doc("users/coreB").set({ group: "core-staff", displayName: "Alpha B", email: "b@example.com", eventStaffEvents: [] }),
      db.doc("users/staffS").set({ group: "staff", displayName: "Staff S", email: "s@example.com", eventStaffEvents: ["ev1"] }),
      db.doc("users/userU").set({ group: "user", displayName: "User U", email: "u@example.com", eventStaffEvents: ["ev1"] }),
      db.doc("users/presP").set({ group: "president", displayName: "Pres P", email: "p@example.com" }),
      db.doc("users/goneG").set({ group: "core-staff", displayName: "Gone G", email: "g@example.com", deleteAt: Timestamp.fromMillis(now + 86_400_000) }),
      db.doc("upcomingEvents/ev1").set({ title: "Event One", titleCn: "活动一", published: true, startAt: Timestamp.fromMillis(now + 86_400_000), endAt: Timestamp.fromMillis(now + 90_000_000), secretField: "x" }),
      db.doc("upcomingEvents/ev2").set({ title: "Event Two", published: false, startAt: Timestamp.fromMillis(now + 2 * 86_400_000), endAt: Timestamp.fromMillis(now + 2 * 90_000_000) }),
      db.doc("pastEvents/ev0").set({ title: "Old Event", date: "2025-03-01", published: true }),
    ]);
    // "nobody" has a manager user but no account here.
    for (const uid of ["coreA", "coreB", "staffS", "userU", "presP", "goneG", "nobody"]) await managerAuth.createUser({ uid });
  });

  test("issueManagerToken: core staff get a manager token and the return URL", async () => {
    const { status, body } = await callable("issueManagerToken", await siteIdToken("coreA"));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.result.returnUrl, `${ORIGIN}/`);
    const token = decode(body.result.token);
    assert.equal(token.uid, "coreA");
    assert.equal(token.claims.group, "core-staff");
    assert.equal(token.claims.accessUntil - token.claims.mintedAt, 24 * 60 * 60 * 1000);
  });

  test("issueManagerToken: the president is allowed", async () => {
    const { status, body } = await callable("issueManagerToken", await siteIdToken("presP"));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(decode(body.result.token).claims.group, "president");
  });

  test("issueManagerToken: staff and accounts pending deletion are refused", async () => {
    for (const uid of ["staffS", "goneG"]) {
      const { status, body } = await callable("issueManagerToken", await siteIdToken(uid));
      assert.equal(status, 403, uid);
      assert.equal(body.error.details.code, "manager-not-allowed", uid);
    }
  });

  test("managerApi: preflight answers the manager's origin and no other", async () => {
    const headers = { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" };
    const res = await api("/v1/me", { method: "OPTIONS", headers });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(res.headers.get("access-control-allow-headers"), "Authorization");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET");
    const other = await api("/v1/me", { method: "OPTIONS", headers, origin: "https://elsewhere.example" });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  });

  test("managerApi: /me is the caller, without email, readable by the manager's page only", async () => {
    const res = await api("/v1/me", { token: managerIdToken("coreA") });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { uid: "coreA", displayName: "Core A", photoURL: "https://img/a", group: "core-staff", title: "Lead", titleCn: "负责人" });
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const other = await api("/v1/me", { token: managerIdToken("coreA"), origin: "https://elsewhere.example" });
    assert.equal(other.status, 200);
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  });

  test("managerApi: /team is staff and above, highest group first, then by name", async () => {
    const res = await api("/v1/team", { token: managerIdToken("coreA") });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.people.map((p) => p.uid), ["presP", "coreB", "coreA", "goneG", "staffS"]);
    assert.ok(res.body.people.every((p) => !("email" in p)));
  });

  test("managerApi: /events is unarchived soonest first, then archived, with only its own fields", async () => {
    const res = await api("/v1/events", { token: managerIdToken("coreA") });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.events.map((e) => [e.id, e.archived, e.published]), [["ev1", false, true], ["ev2", false, false], ["ev0", true, true]]);
    assert.equal(res.body.events[2].date, "2025-03-01");
    assert.equal(res.body.events[2].startAt, null);
    assert.ok(!("secretField" in res.body.events[0]));
  });

  test("managerApi: /events/{id}/staff is that event's staff, and 404s for an unknown event", async () => {
    const res = await api("/v1/events/ev1/staff", { token: managerIdToken("coreA") });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.eventId, "ev1");
    assert.deepEqual(res.body.staff.map((p) => p.uid), ["coreA", "staffS", "userU"]);
    const missing = await api("/v1/events/nope/staff", { token: managerIdToken("coreA") });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "event-not-found");
  });

  test("managerApi: refuses what it should", async () => {
    assert.equal((await api("/v1/me")).body.error.code, "missing-token");
    assert.equal((await api("/v1/me", { token: "garbage" })).body.error.code, "invalid-token");
    assert.equal((await api("/v1/me", { token: managerIdToken("coreA", { provider: "password" }) })).body.error.code, "invalid-token");
    const expired = await api("/v1/me", { token: managerIdToken("coreA", { accessUntil: Date.now() - 1 }) });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "session-expired");
    const staff = await api("/v1/me", { token: managerIdToken("staffS") });
    assert.equal(staff.status, 403);
    assert.equal(staff.body.error.code, "not-allowed");
    assert.equal((await api("/v1/me", { token: managerIdToken("goneG") })).status, 403);
    assert.equal((await api("/v1/me", { token: managerIdToken("nobody") })).body.error.code, "session-ended");
    assert.equal((await api("/v1/nope", { token: managerIdToken("coreA") })).status, 404);
    const post = await api("/v1/me", { token: managerIdToken("coreA"), method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
  });

  test("managerApi: a sign-in from before the account's devices were signed out is refused, a later one isn't", async () => {
    const before = managerIdToken("coreB", { mintedAt: Date.now() - 5000, authTime: Math.floor(Date.now() / 1000) - 5 });
    assert.equal((await api("/v1/me", { token: before })).status, 200);
    await db.doc("users/coreB").update({ sessionsEndedAt: Timestamp.now() });
    const res = await api("/v1/me", { token: before });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "session-ended");
    await nextSecond();
    assert.equal((await api("/v1/me", { token: managerIdToken("coreB") })).status, 200);
  });

  test("managerApi: losing core staff here cuts it off at once", async () => {
    await db.doc("users/goneG").update({ deleteAt: null });
    const token = managerIdToken("goneG");
    assert.equal((await api("/v1/me", { token })).status, 200);
    await db.doc("users/goneG").update({ group: "staff" });
    const res = await api("/v1/me", { token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "not-allowed");
  });

  test("signing out everywhere revokes the manager sign-ins", async () => {
    const was = await validSince("presP");
    await nextSecond();
    const { status, body } = await callable("endAllSessions", await siteIdToken("presP"));
    assert.equal(status, 200, JSON.stringify(body));
    assert.notEqual(await validSince("presP"), was);
  });

  test("signing out other devices revokes the manager sign-ins too", async () => {
    await nextSecond();
    const was = await validSince("coreB");
    const site = await siteIdToken("coreB");
    // endOtherSessions needs the caller's device on the list.
    assert.equal((await callable("touchSession", site)).status, 200);
    await nextSecond();
    const { status, body } = await callable("endOtherSessions", site);
    assert.equal(status, 200, JSON.stringify(body));
    assert.notEqual(await validSince("coreB"), was);
  });

  test("demoting core staff revokes their manager sign-ins; promoting doesn't", async () => {
    await nextSecond();
    const president = await siteIdToken("presP");
    const coreWas = await validSince("coreA");
    const staffWas = await validSince("staffS");
    await nextSecond();
    const demote = await callable("changeUserGroup", president, { targetUid: "coreA", newGroup: "staff" });
    assert.equal(demote.status, 200, JSON.stringify(demote.body));
    assert.notEqual(await validSince("coreA"), coreWas);
    const promote = await callable("changeUserGroup", president, { targetUid: "staffS", newGroup: "core-staff" });
    assert.equal(promote.status, 200, JSON.stringify(promote.body));
    assert.equal(await validSince("staffS"), staffWas);
  });

  test("deleting an account deletes its manager user", async () => {
    await db.doc("users/userU").delete();
    // onUserDeleted runs in the background; its record is the last thing it writes.
    for (let i = 0; i < 40 && !(await db.doc("records/account-deleted-userU").get()).exists; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok((await db.doc("records/account-deleted-userU").get()).exists, "onUserDeleted never wrote its record");
    await assert.rejects(managerAuth.getUser("userU"), (e) => e.code === "auth/user-not-found");
  });
});

describe("SKBY Manager not set up", { skip: !!MANAGER }, () => {
  test("issueManagerToken refuses, the API isn't there, and signing out works as before", async () => {
    await db.doc("users/coreA").set({ group: "core-staff", displayName: "Core A" });
    const site = await siteIdToken("coreA");
    const issue = await callable("issueManagerToken", site);
    assert.equal(issue.status, 400, JSON.stringify(issue.body));
    assert.equal(issue.body.error.details.code, "manager-off");
    const res = await api("/v1/me", { origin: "http://127.0.0.1:5000" });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal((await callable("endAllSessions", site)).status, 200);
  });
});
