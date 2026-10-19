import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

// npm run dev, in one terminal: the emulators under demo-sekaibeyond, the functions build in watch mode, and the
// site once the emulators answer.
//
// Each runs in its own process group, so Ctrl+C reaches only this script, which passes it on once. The emulators
// take a second Ctrl+C as "stop now, without saving", and one keypress can arrive here twice, from the terminal and
// forwarded by npm.

const emulatorPorts = Object.values(JSON.parse(readFileSync("firebase.json", "utf-8")).emulators as object)
    .flatMap((config) => (typeof config === "object" && "port" in config ? [config.port as number] : []));

const children: ChildProcess[] = [];
let stoppedAt = 0;

// SIGINT, as Ctrl+C would send, so the emulators save their data to .emulator-data on the way out. A signal over a
// second after the first, such as a second Ctrl+C, is passed on too.
const stop = () => {
    if (stoppedAt && Date.now() - stoppedAt < 1000) return;
    stoppedAt ||= Date.now();
    for (const child of children) {
        try {
            process.kill(-child.pid!, "SIGINT");
        } catch {
            // Already gone.
        }
    }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);

const run = (command: string, args: string[]) => {
    const child = spawn(command, args, {stdio: ["ignore", "inherit", "inherit"], detached: true});
    children.push(child);
    // One stopping on its own, such as the emulators failing to start, stops the rest.
    child.on("exit", (code) => {
        if (!stoppedAt && code !== 0) process.exitCode = code ?? 1;
        stop();
        if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit();
    });
};

const portOpen = (port: number) => new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1")
        .once("connect", () => {
            socket.destroy();
            resolve(true);
        })
        .once("error", () => resolve(false));
});

// The emulators load the functions as they start, so build them first.
if (spawnSync("npm", ["--prefix", "functions", "run", "build"], {stdio: "inherit"}).status !== 0) process.exit(1);

run("firebase", [
    "emulators:start", "--project", "demo-sekaibeyond", "--only", "auth,firestore,functions,storage",
    "--import", ".emulator-data", "--export-on-exit",
]);
// The emulators reload the functions after each build.
run("npm", ["--prefix", "functions", "run", "build", "--", "--watch", "--preserveWatchOutput"]);

// Started last, so the site's first requests find the emulators up.
while (!stoppedAt && !(await Promise.all(emulatorPorts.map(portOpen))).every(Boolean)) await sleep(500);
if (!stoppedAt) run("react-router", ["dev", "--mode", "emulator"]);
