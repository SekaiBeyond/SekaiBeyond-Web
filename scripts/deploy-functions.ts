import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

// Deploying all functions at once exceeds Cloud Functions' per-minute mutation quota for the region,
// so deploy them in batches spaced at least a minute apart.
const batchSize = 40;
const minBatchSpacingMs = 60_000;
const dryRun = process.argv.includes("--dry-run");

const require = createRequire(import.meta.url);
const libPath = require.resolve("../functions/lib/index.js");
const local = Object.keys(require(libPath) as Record<string, unknown>).sort();
if (local.length === 0) {
    console.error(`No functions exported from ${libPath} — run \`npm --prefix functions run build\` first.`);
    process.exit(1);
}

const batches: string[][] = [];
for (let i = 0; i < local.length; i += batchSize) batches.push(local.slice(i, i + batchSize));

const firebase = (args: string[]) => spawnSync("firebase", args, {stdio: "inherit"}).status === 0;
const deployArgs = (batch: string[]) => ["deploy", "--only", batch.map((name) => `functions:${name}`).join(",")];

const failed: string[][] = [];
for (const [i, batch] of batches.entries()) {
    console.log(`\nBatch ${i + 1} of ${batches.length} (${batch.length} functions): ${batch.join(", ")}`);
    if (dryRun) continue;

    const start = Date.now();
    if (!firebase(deployArgs(batch))) failed.push(batch);
    if (i < batches.length - 1) await sleep(Math.max(0, minBatchSpacingMs - (Date.now() - start)));
}

// A filtered deploy never deletes anything, so offer to delete deployed functions no longer in the source,
// as a full deploy would. functions:delete asks before deleting.
const listing = JSON.parse(execFileSync("firebase", ["functions:list", "--json"], {encoding: "utf-8"})) as {
    result: {id: string}[];
};
const stale = [...new Set(listing.result.map((fn) => fn.id))].filter((id) => !local.includes(id));
if (stale.length > 0) {
    console.log(`\nDeployed but no longer in the source: ${stale.join(", ")}`);
    if (!dryRun) firebase(["functions:delete", ...stale]);
}

if (failed.length > 0) {
    console.error(`\n${failed.length} of ${batches.length} batches had errors. To retry them, run:`);
    for (const batch of failed) console.error(`  firebase ${deployArgs(batch).join(" ")}`);
    process.exit(1);
}
