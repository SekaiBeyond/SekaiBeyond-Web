import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

// npm run dev, in one terminal: the emulators under demo-sekaibeyond, the functions build in watch mode, and the
// site once the emulators answer.
//
// On macOS and Linux each runs in its own process group, so Ctrl+C reaches only this script, which passes it on once.
// The emulators take a second Ctrl+C as "stop now, without saving", and one keypress can arrive here twice, from the
// terminal and forwarded by npm.
//
// Windows has neither process groups nor signals to send. Ctrl+C reaches every process in the console window by
// itself, once each, so there is nothing to pass on, and a process can only be stopped from here by ending it outright.

const windows = process.platform === "win32";

const emulatorPorts = Object.values(JSON.parse(readFileSync("firebase.json", "utf-8")).emulators as object)
    .flatMap((config) => (typeof config === "object" && "port" in config ? [config.port as number] : []));

const children: ChildProcess[] = [];
let stoppedAt = 0;

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

// Ends processes outright on Windows, with everything under them: the shell, the command in it, and what that started,
// such as the Firestore emulator's Java. taskkill /t can miss some. It lists a tree once, so misses what starts after,
// as the functions build does when the emulators fail at once. And Node ends what it started itself when it goes, so
// ending npm ends its shell before anything can find the command in it. So this remembers every process it has seen,
// gone or not, takes in any that names one as its parent, and ends them all, until a look round finds nothing new.
const endTrees = (pids: number[]) => {
    const script = `
        $seen = [Collections.Generic.HashSet[uint32]]::new()
        foreach ($id in @(${pids.join(",")})) { [void]$seen.Add($id) }
        $round = 0
        do {
            $all = @(Get-CimInstance Win32_Process)
            $added = $false
            do {
                $more = $false
                foreach ($p in $all) {
                    if ($seen.Contains($p.ParentProcessId) -and $seen.Add($p.ProcessId)) { $more = $added = $true }
                }
            } while ($more)
            Stop-Process -Id @($seen) -Force -ErrorAction Ignore
            $round++
        } while ($added -or $round -lt 2)`;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {stdio: "ignore"});
};

// SIGINT, as Ctrl+C would send, so the emulators save their data to .emulator-data on the way out. A signal over a
// second after the first, such as a second Ctrl+C, is passed on too.
//
// On Windows this only runs when one of them stops on its own, and the rest are ended outright, so the emulators don't
// save.
const stop = () => {
    if (stoppedAt && Date.now() - stoppedAt < 1000) return;
    stoppedAt ||= Date.now();
    if (windows) {
        endTrees(children.filter(running).map((child) => child.pid!));
        return;
    }
    for (const child of children) {
        try {
            process.kill(-child.pid!, "SIGINT");
        } catch {
            // Already gone.
        }
    }
};
// On Windows, Ctrl+C has already reached them.
const onSignal = windows ? () => void (stoppedAt ||= Date.now()) : stop;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, onSignal);

// On Windows npm, firebase and react-router are .cmd files, which Node starts only through a shell, and after a Ctrl+C
// npm's asks "Terminate batch job (Y/N)?". So npm runs as the npm running this script, when it is one, and the others
// through a shell. Nothing here needs quoting.
const command = (name: string, args: string[]) => {
    if (!windows) return {file: name, args, shell: false};
    const npm = process.env.npm_execpath;
    if (name === "npm" && npm) return {file: process.execPath, args: [npm, ...args], shell: false};
    return {file: [name, ...args].join(" "), args: [], shell: true};
};

const run = (name: string, args: string[]) => {
    const {file, args: fileArgs, shell} = command(name, args);
    const child = spawn(file, fileArgs, {stdio: ["ignore", "inherit", "inherit"], detached: !windows, shell});
    children.push(child);
    // One stopping on its own, such as the emulators failing to start, stops the rest.
    child.on("exit", (code) => {
        if (!stoppedAt) {
            if (code !== 0) process.exitCode = code ?? 1;
            stop();
        }
        if (!children.some(running)) process.exit();
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
const build = command("npm", ["--prefix", "functions", "run", "build"]);
if (spawnSync(build.file, build.args, {stdio: "inherit", shell: build.shell}).status !== 0) process.exit(1);

run("firebase", [
    "emulators:start", "--project", "demo-sekaibeyond", "--only", "auth,firestore,functions,storage",
    "--import", ".emulator-data", "--export-on-exit",
]);
// The emulators reload the functions after each build.
run("npm", ["--prefix", "functions", "run", "build", "--", "--watch", "--preserveWatchOutput"]);

// Started last, so the site's first requests find the emulators up.
while (!stoppedAt && !(await Promise.all(emulatorPorts.map(portOpen))).every(Boolean)) await sleep(500);
if (!stoppedAt) run("react-router", ["dev", "--mode", "emulator"]);
