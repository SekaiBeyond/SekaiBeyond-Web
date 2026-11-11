// One-off: brings existing accounts onto our own account system. Every account
// was made through Google and lives in Firebase Auth, so this copies what we
// need out of there: the address into users/{uid}.email and emailIndex, and the
// bound Google account into credentials/{uid} and googleIndex.
//
// Dry run by default; --apply writes. Runs as you, through Application Default
// Credentials (`gcloud auth application-default login`), from functions/:
//
//   node scripts/migrate-accounts.mts [--project <id>] [--apply]
//
// Safe to re-run, and worth doing once more right after the deploy, to catch
// anyone who signed up in between. An account with a credentials doc has moved
// over and is skipped, so a later email change or unbind is never undone. The
// one thing still done for it is indexing its address, when it moved over
// without it (adoptFromFirebase, for an address another account held) and the
// address has since been freed.
//
// It also says who asked for each deletion pending from before accounts kept
// that (deletionRequestedBy), from the request's record, so an owner can cancel
// their own request after the deploy.
//
// Once a real Google sign-in has worked on the live site and Firebase's Google
// provider is off, this removes Google from Firebase Auth's own records too,
// which can't be undone:
//
//   node scripts/migrate-accounts.mts --strip-google [--project <id>] [--apply]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const stripGoogle = args.includes("--strip-google");
const projectFlag = args.indexOf("--project");
const GOOGLE = "google.com";
const BATCH_SIZE = 400;

function defaultProject(): string | undefined {
    try {
        const rc = JSON.parse(readFileSync(new URL("../../.firebaserc", import.meta.url), "utf-8"));
        return rc.projects?.default;
    } catch {
        return undefined;
    }
}

const projectId = (projectFlag >= 0 ? args[projectFlag + 1] : undefined)
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? defaultProject();
if (!projectId) {
    console.error("No project: pass --project <id> or set GOOGLE_CLOUD_PROJECT.");
    process.exit(1);
}

initializeApp({projectId});
const db = getFirestore();
const auth = getAuth();

// Copied rather than imported, because node loads src as CommonJS and a script
// can't import from it: normalizeEmail and emailIndexRef's hash in
// src/utils/accountEmail.ts.
const normalize = (email: string | undefined) => (email ?? "").trim().toLowerCase();
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex");

/** "alice@gmail.com" as "al•••@gmail.com", so a report can be pasted around. */
function mask(email: string): string {
    const at = email.lastIndexOf("@");
    return at < 1 ? "•••" : `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

async function allAuthUsers(): Promise<Map<string, UserRecord>> {
    const users = new Map<string, UserRecord>();
    let pageToken: string | undefined;
    do {
        const page = await auth.listUsers(1000, pageToken);
        for (const user of page.users) users.set(user.uid, user);
        pageToken = page.pageToken;
    } while (pageToken);
    return users;
}

const googleOf = (record: UserRecord | undefined) => record?.providerData.find(p => p.providerId === GOOGLE);

console.log(`Project ${projectId}${apply ? "" : " (dry run; --apply writes)"}`);
const authUsers = await allAuthUsers();
const userDocs = (await db.collection("users").get()).docs;
const moved = new Set((await db.collection("credentials").select().get()).docs.map(doc => doc.id));

if (stripGoogle) {
    const uids = new Set(userDocs.map(doc => doc.id));
    const bound = [...authUsers.values()].filter(record => googleOf(record));
    // A Google account only Firebase knows about would be lost for good.
    const stranded = bound.filter(record => uids.has(record.uid) && !moved.has(record.uid));
    if (stranded.length > 0) {
        console.error(`${stranded.length} accounts haven't moved over, so stopping. Run this without --strip-google:`);
        for (const record of stranded) console.error(`  ${record.uid}`);
        process.exit(1);
    }
    console.log(`${bound.length} Firebase Auth records have Google on them.`);
    if (apply) {
        for (const record of bound) await auth.updateUser(record.uid, {providersToUnlink: [GOOGLE]});
        console.log(`Removed it from ${bound.length}.`);
    }
    process.exit(0);
}

interface Move {
    uid: string;
    email: string;
    /** Firebase Auth only lets one account hold an address, so its say settles a tie. */
    fromAuth: boolean;
    record: UserRecord | undefined;
    ref: FirebaseFirestore.DocumentReference;
    storedEmail: string;
    /** Moved over already, and only its address is left to index. */
    indexOnly: boolean;
}

const held = new Map<string, string>(
    (await db.collection("emailIndex").get()).docs.map(doc => [doc.id, doc.get("uid") as string]),
);

// Addresses held for an account that moved off them while the link undoing that
// still works (addressHeldForUndo in src/utils/emailUndo.ts, copied for the same
// reason as normalize): taking one would leave that link dead.
const userEmails = new Map(userDocs.map(doc => [doc.id, doc.get("email") as unknown]));
const heldForUndo = new Set<string>();
for (const undo of (await db.collection("emailUndos").get()).docs) {
    const expiresAt = undo.get("expiresAt");
    if (!(expiresAt?.toMillis?.() > Date.now())) continue;
    const email = userEmails.get(undo.get("uid"));
    if (email === (undo.get("restoredAt") ? undo.get("oldEmail") : undo.get("newEmail"))) heldForUndo.add(undo.get("oldEmail"));
}

const moves: Move[] = [];
for (const doc of userDocs) {
    const record = authUsers.get(doc.id);
    const storedEmail = typeof doc.get("email") === "string" ? doc.get("email") : "";
    if (moved.has(doc.id)) {
        const email = normalize(storedEmail);
        if (email && held.get(emailKey(email)) !== doc.id) {
            moves.push({uid: doc.id, email, fromAuth: false, record, ref: doc.ref, storedEmail, indexOnly: true});
        }
        continue;
    }
    const authEmail = normalize(record?.email);
    moves.push({
        uid: doc.id,
        email: authEmail || normalize(storedEmail),
        fromAuth: authEmail !== "",
        record,
        ref: doc.ref,
        storedEmail,
        indexOnly: false,
    });
}

const byEmail = new Map<string, Move[]>();
for (const move of moves) {
    if (!move.email) continue;
    byEmail.set(move.email, [...byEmail.get(move.email) ?? [], move]);
}

const conflicts: Move[] = [];
const winners = new Map<string, Move>();
for (const [email, claimants] of byEmail) {
    const heldBy = held.get(emailKey(email)) ?? (heldForUndo.has(email) ? "an undo link" : undefined);
    const contenders = claimants.length === 1 ? claimants : claimants.filter(move => move.fromAuth);
    const winner = !heldBy && contenders.length === 1 ? contenders[0] : undefined;
    if (winner) winners.set(winner.uid, winner);
    conflicts.push(...claimants.filter(move => move !== winner));
}

// Left for a person to settle, and picked up by a re-run once they have.
for (const move of conflicts) console.log(`  conflict: ${move.uid} wants ${mask(move.email)}, held by another account`);
const noEmail = moves.filter(move => !move.email);
for (const move of noEmail) console.log(`  no address: ${move.uid} (no sign-in by password until staff give it one)`);

const conflicted = new Set(conflicts.map(move => move.uid));
const toMove = moves.filter(move => !move.indexOnly && !conflicted.has(move.uid));
const toIndex = moves.filter(move => move.indexOnly && winners.has(move.uid));
const google = toMove.filter(move => googleOf(move.record));
const emailChanges = toMove.filter(move => move.email && move.email !== move.storedEmail);

// Deletions asked for before accounts said who asked: the request's record says.
// One without a record stays staff's to cancel, as every one did until now.
const unattributed = userDocs.filter(doc =>
    doc.get("deleteAt")?.toMillis?.() > Date.now() && typeof doc.get("deletionRequestedBy") !== "string");
const requestedBy = new Map<string, string>();
for (const doc of unattributed) {
    const requests = (await db.collection("records").where("targetUid", "==", doc.id).get()).docs
        .filter(record => record.get("type") === "account-deletion-requested")
        .sort((a, b) => (b.get("timestamp")?.toMillis?.() ?? 0) - (a.get("timestamp")?.toMillis?.() ?? 0));
    const by: unknown = requests[0]?.get("performedBy");
    if (typeof by === "string") requestedBy.set(doc.id, by);
}

console.log(`${userDocs.length} accounts, ${moved.size} already moved, ${toMove.length} to move:`);
console.log(`  ${google.length} with Google bound`);
console.log(`  ${emailChanges.length} whose stored address changes to Firebase Auth's`);
console.log(`  ${conflicts.length} in conflict, ${noEmail.length} with no address`);
console.log(`  ${[...authUsers.keys()].filter(uid => !userDocs.some(doc => doc.id === uid)).length} Firebase logins with no account, ignored`);
console.log(`${toIndex.length} moved over without their address, now free to index`);
console.log(`${unattributed.length} pending deletions without who asked, ${requestedBy.size} found in records`);

if (!apply) process.exit(conflicts.length > 0 ? 2 : 0);

let batch = db.batch();
let pending = 0;
const flush = async () => {
    if (pending > 0) await batch.commit();
    batch = db.batch();
    pending = 0;
};

for (const move of toMove) {
    const provider = googleOf(move.record);
    batch.set(db.collection("credentials").doc(move.uid), {
        passwordHash: null,
        google: provider ? {
            sub: provider.uid,
            email: normalize(provider.email),
            name: provider.displayName ?? "",
            photoURL: provider.photoURL ?? move.record?.photoURL ?? "",
            signUpName: move.record?.displayName ?? "",
        } : null,
    });
    if (provider) batch.set(db.collection("googleIndex").doc(provider.uid), {uid: move.uid});
    if (winners.has(move.uid)) {
        batch.set(db.collection("emailIndex").doc(emailKey(move.email)), {uid: move.uid});
        if (move.email !== move.storedEmail) batch.update(move.ref, {email: move.email});
    }
    pending += 4;
    if (pending >= BATCH_SIZE) await flush();
}
for (const move of toIndex) {
    batch.set(db.collection("emailIndex").doc(emailKey(move.email)), {uid: move.uid});
    pending += 1;
    if (pending >= BATCH_SIZE) await flush();
}
await flush();
console.log(`Moved ${toMove.length} accounts, and indexed ${toIndex.length} addresses.`);

// One at a time, checking each is still pending and unattributed.
for (const [uid, by] of requestedBy) {
    await db.runTransaction(async (txn) => {
        const user = await txn.get(db.collection("users").doc(uid));
        if (user.get("deleteAt")?.toMillis?.() > Date.now() && typeof user.get("deletionRequestedBy") !== "string") {
            txn.update(user.ref, {deletionRequestedBy: by});
        }
    });
}
console.log(`Said who asked for ${requestedBy.size} pending deletions.`);
