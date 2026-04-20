/**
 * One-shot backfill: rename `name`/`nameCn` → `title`/`titleCn` on all
 * `upcomingEvents` docs, then delete the legacy fields.
 *
 * Run once per environment after deploying the rename, then delete this file.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx ts-node scripts/backfill-upcoming-title.ts
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp({credential: applicationDefault()});
const db = getFirestore();

async function main(): Promise<void> {
    const snap = await db.collection("upcomingEvents").get();
    let migrated = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
        const d = doc.data();
        const hasLegacy = d.name !== undefined || d.nameCn !== undefined;
        if (!hasLegacy) {
            skipped++;
            continue;
        }
        await doc.ref.update({
            title: d.title ?? d.name ?? "",
            titleCn: d.titleCn ?? d.nameCn ?? "",
            name: FieldValue.delete(),
            nameCn: FieldValue.delete(),
        });
        migrated++;
    }

    console.log(`Backfill complete: migrated=${migrated}, skipped=${skipped}, total=${snap.size}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
