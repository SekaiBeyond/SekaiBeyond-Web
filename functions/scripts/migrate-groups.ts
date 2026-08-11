/**
 * One-off migration for the group/membership split: `group: 'visitor' -> 'user'`.
 *
 * `group` becomes a pure role ladder and membership moves to membershipExpiresAt.
 * Nobody holds the retired `member` group, so this only has to collapse `visitor`
 * into the new base group — it grants no membership and writes no audit records.
 * If a `member` document does turn up the script refuses to run rather than guess
 * at a term for it; grant that person membership from the admin panel first, then
 * re-run.
 *
 * Runs read-only unless --apply is passed:
 *
 *   cd functions
 *   npx tsx scripts/migrate-groups.ts             # dry run
 *   npx tsx scripts/migrate-groups.ts --apply     # migrate
 *
 * Needs application-default credentials for the project:
 *   gcloud auth application-default login
 *   export GOOGLE_CLOUD_PROJECT=<project-id>
 *
 * Safe to re-run: migrated documents no longer match the query.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PAGE_SIZE = 400;

const apply = process.argv.slice(2).includes("--apply");

initializeApp({credential: applicationDefault()});
const db = getFirestore();

async function migrate(): Promise<void> {
    // Membership used to be a group, so a `member` document carries no term we
    // could carry over. Stop rather than invent one.
    const strays = await db.collection("users").where("group", "==", "member").limit(1).get();
    if (!strays.empty) {
        console.error(
            "Found user(s) still in the retired `member` group. Membership is now a " +
            "separate attribute with no term recorded on these documents. Grant them " +
            "membership from the admin panel, then re-run this migration.",
        );
        process.exit(1);
    }

    let migrated = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (; ;) {
        // Paged by document id. A dry run needs the cursor because nothing leaves
        // the result set; an --apply run is also safe to restart from scratch,
        // since migrated documents stop matching the query.
        let q = db.collection("users")
            .where("group", "==", "visitor")
            .orderBy("__name__")
            .limit(PAGE_SIZE);
        if (cursor) q = q.startAfter(cursor);

        const snap = await q.get();
        if (snap.empty) break;
        cursor = snap.docs[snap.docs.length - 1];
        migrated += snap.size;

        if (apply) {
            const batch = db.batch();
            for (const doc of snap.docs) {
                batch.update(doc.ref, {group: "user"});
            }
            await batch.commit();
            console.log(`Migrated ${snap.size} document(s)...`);
        }

        if (snap.size < PAGE_SIZE) break;
    }

    console.log(`${apply ? "Migrated" : "Would migrate"} ${migrated} visitor(s) -> user.`);
    if (!apply) {
        console.log("Read-only run. Re-run with --apply to write.");
    }
}

migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
