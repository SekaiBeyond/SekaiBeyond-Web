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
// over and is skipped, so a later email change or unbind is never undone.
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
}

const moves: Move[] = [];
for (const doc of userDocs) {
    if (moved.has(doc.id)) continue;
    const record = authUsers.get(doc.id);
    const authEmail = normalize(record?.email);
    const storedEmail = typeof doc.get("email") === "string" ? doc.get("email") : "";
    moves.push({
        uid: doc.id,
        email: authEmail || normalize(storedEmail),
        fromAuth: authEmail !== "",
        record,
        ref: doc.ref,
        storedEmail,
    });
}

const held = new Map<string, string>(
    (await db.collection("emailIndex").get()).docs.map(doc => [doc.id, doc.get("uid") as string]),
);
const byEmail = new Map<string, Move[]>();
for (const move of moves) {
    if (!move.email) continue;
    byEmail.set(move.email, [...byEmail.get(move.email) ?? [], move]);
}

const conflicts: Move[] = [];
const winners = new Map<string, Move>();
for (const [email, claimants] of byEmail) {
    const heldBy = held.get(emailKey(email));
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
const toMove = moves.filter(move => !conflicted.has(move.uid));
const google = toMove.filter(move => googleOf(move.record));
const emailChanges = toMove.filter(move => move.email && move.email !== move.storedEmail);

console.log(`${userDocs.length} accounts, ${moved.size} already moved, ${toMove.length} to move:`);
console.log(`  ${google.length} with Google bound`);
console.log(`  ${emailChanges.length} whose stored address changes to Firebase Auth's`);
console.log(`  ${conflicts.length} in conflict, ${noEmail.length} with no address`);
console.log(`  ${[...authUsers.keys()].filter(uid => !userDocs.some(doc => doc.id === uid)).length} Firebase logins with no account, ignored`);

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
await flush();
console.log(`Moved ${toMove.length} accounts.`);
