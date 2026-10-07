// One-off: delete admin uploads in Storage that nothing points at any more —
// images and clips a save replaced or dropped before saves cleaned up after
// themselves, and uploads abandoned before their save (a cancelled team-member
// modal, a discarded con draft, a save that failed after its upload). That last
// kind still accumulates, so this is worth re-running now and then.
//
// Dry run by default; --apply deletes. Runs as you, through Application Default
// Credentials (`gcloud auth application-default login`), from functions/:
//
//   node scripts/cleanup-orphaned-uploads.mts [--project <id>] [--bucket <name>] [--min-age-days <n>] [--apply]
//
// A file counts as used if its URL appears anywhere in a scanned document —
// email templates and queued mail included — so it errs towards keeping. Never
// touched: avatars/ and banners/ (one fixed object per user, deleted with the
// account), upcoming-events/headers/ (its URLs are baked into ticket emails
// already sent), and anything changed in the last --min-age-days (default 7),
// which may be an upload whose save hasn't happened yet.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

function defaultProject(): string | undefined {
    try {
        const rc = JSON.parse(readFileSync(new URL("../../.firebaserc", import.meta.url), "utf-8"));
        return rc.projects?.default;
    } catch {
        return undefined;
    }
}

const projectId = flag("--project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? defaultProject();
if (!projectId) {
    console.error("No project: pass --project <id> or set GOOGLE_CLOUD_PROJECT.");
    process.exit(1);
}

const minAgeDays = Number(flag("--min-age-days") ?? 7);
if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
    console.error("--min-age-days must be a number of days, 0 or more.");
    process.exit(1);
}

// Where the admin panel uploads to: ALLOWED_UPLOAD_PREFIXES in src/utils/storage.ts.
const SWEPT = ["badges/", "events/", "upcoming-events/", "team/", "config/", "passports/", "con/"];
const KEPT = ["upcoming-events/headers/"];
// Too large to read whole, and never hold an upload's URL.
const UNSCANNED = new Set(["records", "scans", "rateLimits"]);

initializeApp({projectId});
const db = getFirestore();

// Projects made since late 2024 get <id>.firebasestorage.app; older ones <id>.appspot.com.
async function findBucket() {
    const bucketFlag = flag("--bucket");
    const names = bucketFlag ? [bucketFlag] : [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
    for (const name of names) {
        const bucket = getStorage().bucket(name);
        if ((await bucket.exists())[0]) return bucket;
    }
    console.error(`No bucket found (tried ${names.join(", ")}): pass --bucket <name>.`);
    process.exit(1);
}
const bucket = await findBucket();

// The same URL shape extractStoragePath reads, found anywhere in a string so
// that markup (an email template, a queued email) counts too.
const STORAGE_URL = /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#"'\s<>)]+)/g;

function collectPaths(value: unknown, into: Set<string>): void {
    if (typeof value === "string") {
        for (const match of value.matchAll(STORAGE_URL)) {
            try {
                into.add(decodeURIComponent(match[1]));
            } catch {
                // A malformed escape can't name one of our objects.
            }
        }
    } else if (Array.isArray(value)) {
        for (const item of value) collectPaths(item, into);
    } else if (value && typeof value === "object") {
        // Firestore maps decode to plain objects; anything else is a Timestamp,
        // GeoPoint, reference or bytes, none of which can hold a URL.
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.prototype || proto === null) {
            for (const item of Object.values(value)) collectPaths(item, into);
        }
    }
}

const referenced = new Set<string>();
const scan = (doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    // The hero no longer has a poster, but the draft's merge write keeps one saved
    // before then. Nothing reads it, so it doesn't count as a use.
    if (doc.ref.parent.id === "conContent") delete data.heroVideo?.poster;
    collectPaths(data, referenced);
};
for (const collection of await db.listCollections()) {
    if (UNSCANNED.has(collection.id)) continue;
    (await collection.get()).docs.forEach(scan);
}
// Of the subcollections, only an event's email template holds author markup,
// which can carry an image of its own.
(await db.collectionGroup("emailTemplate").get()).docs.forEach(scan);

const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
const orphans: {name: string; size: number; ageDays: number}[] = [];
let tooNew = 0;
for (const prefix of SWEPT) {
    const [files] = await bucket.getFiles({prefix});
    for (const file of files) {
        // A console-made folder is a zero-byte object named like one.
        if (file.name.endsWith("/") || referenced.has(file.name)) continue;
        if (KEPT.some(kept => file.name.startsWith(kept))) continue;
        const updated = Date.parse(String(file.metadata.updated ?? ""));
        if (!Number.isFinite(updated) || updated > cutoff) {
            tooNew++;
            continue;
        }
        orphans.push({
            name: file.name,
            size: Number(file.metadata.size ?? 0),
            ageDays: Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000)),
        });
    }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const target = `${projectId} (${bucket.name})`;
const newNote = tooNew > 0 ? ` ${tooNew} unused file(s) changed in the last ${minAgeDays} day(s) were left alone.` : "";

if (orphans.length === 0) {
    console.log(`${target}: nothing to delete.${newNote}`);
    process.exit(0);
}

// Uploads on hand but no document pointing at any of them means the scan read
// the wrong database, not that every upload is unused.
if (![...referenced].some(path => SWEPT.some(prefix => path.startsWith(prefix)))) {
    console.error(`${target}: no document points at any upload, which suggests the wrong project. Refusing to continue.`);
    process.exit(1);
}

for (const prefix of SWEPT) {
    const group = orphans.filter(o => o.name.startsWith(prefix));
    if (group.length === 0) continue;
    console.log(`${prefix}: ${group.length} file(s), ${mb(group.reduce((n, o) => n + o.size, 0))}`);
    for (const o of group) console.log(`  ${o.name}  ${mb(o.size)}  ${o.ageDays}d old`);
}
const totalSize = mb(orphans.reduce((n, o) => n + o.size, 0));

if (!apply) {
    console.log(`\n${target}: dry run; ${orphans.length} unused file(s), ${totalSize}.${newNote} Re-run with --apply to delete.`);
    process.exit(0);
}

let failed = 0;
for (let i = 0; i < orphans.length; i += 20) {
    await Promise.all(orphans.slice(i, i + 20).map(async o => {
        try {
            await bucket.file(o.name).delete({ignoreNotFound: true});
        } catch (err) {
            failed++;
            console.error(`  failed: ${o.name}`, err);
        }
    }));
}
console.log(`\n${target}: deleted ${orphans.length - failed} file(s), ${totalSize}` +
    `${failed > 0 ? `; ${failed} failed` : ""}.${newNote}`);
if (failed > 0) process.exit(1);
