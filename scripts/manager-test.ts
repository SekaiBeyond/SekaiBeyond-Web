import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// npm run test:manager: SKBY Manager's sign-in and API (functions/src/functions/manager.ts) against the emulators,
// once with the manager set up and once without. Runs manager-test.emulated.mjs inside each, on the functions the
// npm script has just built. The emulators need what npm run dev does: Java 21+ on PATH.

const MANAGER_ENV = {
    MANAGER_PROJECT_ID: "demo-manager",
    MANAGER_SERVICE_ACCOUNT: "signer@demo-manager.iam.gserviceaccount.com",
    MANAGER_ORIGIN: "http://127.0.0.1:5000",
};

// The emulated functions read these files as well as the environment, so a MANAGER_ setting in one would set up the
// manager for the run meant to have it off, or point the other at a different project.
for (const file of ["functions/.env", "functions/.env.local", "functions/.env.demo-test"]) {
    if (existsSync(file) && /^\s*MANAGER_/m.test(readFileSync(file, "utf-8"))) {
        console.error(`${file} sets MANAGER_ settings, which this test sets itself. Comment them out to run it.`);
        process.exit(1);
    }
}

const withoutManager = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("MANAGER_")));

// Through a shell, since npm installs the CLI on Windows as firebase.cmd, which Node can't start on its own.
const run = (label: string, env: NodeJS.ProcessEnv): boolean => {
    console.log(`\n=== ${label} ===`);
    const command = 'firebase emulators:exec --only auth,firestore,functions --project demo-test'
        + ' "node scripts/manager-test.emulated.mjs"';
    return spawnSync(command, {stdio: "inherit", shell: true, env}).status === 0;
};

const results = [
    run("SKBY Manager set up", {...withoutManager, ...MANAGER_ENV}),
    run("SKBY Manager not set up", withoutManager),
];
process.exit(results.every(Boolean) ? 0 : 1);
