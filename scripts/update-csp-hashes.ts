import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const htmlPath = "build/client/index.html";
if (!existsSync(htmlPath)) {
    console.error(`${htmlPath} not found — run \`npm run build\` first.`);
    process.exit(1);
}

const html = readFileSync(htmlPath, "utf-8");

// Non-executable script types that don't need CSP hashes
const nonExecutableTypes = /type\s*=\s*["']?(application\/(json|ld\+json)|importmap)["']?/i;

// Extract inline script contents (skip scripts with src attributes)
const scriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
const hashSet = new Set<string>();
let match: RegExpExecArray | null;

while ((match = scriptRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const content = match[1];

    // Skip external, empty, and non-executable scripts
    if (/\ssrc\s*=/i.test(fullTag) || !content.trim()) continue;
    if (nonExecutableTypes.test(fullTag)) continue;

    const hash = createHash("sha256").update(content).digest("base64");
    hashSet.add(`'sha256-${hash}'`);
}

const hashes = [...hashSet];

// Emit firebase.generated.json so the committed firebase.json isn't mutated by local builds.
const templatePath = "firebase.json";
const outputPath = "firebase.generated.json";

interface FirebaseConfig {
    hosting: {
        headers: {
            headers: {
                key: string;
                value: string;
            }[];
        }[];
    };
}

const firebase = JSON.parse(readFileSync(templatePath, "utf-8")) as FirebaseConfig;

for (const rule of firebase.hosting.headers) {
    for (const header of rule.headers) {
        if (header.key === "Content-Security-Policy") {
            // Replace only the sha256 hashes, preserve all other sources
            header.value = header.value.replace(/script-src\s+([^;]+)/, (_, tokens: string) => {
                const kept = tokens.trim().split(/\s+/).filter((t) => !t.startsWith("'sha256-"));
                return `script-src ${[...kept, ...hashes].join(" ")}`;
            });
        }
    }
}

writeFileSync(outputPath, JSON.stringify(firebase, null, 2) + "\n");
console.log(`Wrote ${outputPath} with ${hashes.length} inline script hashes:`);
hashes.forEach((h) => console.log(`  ${h}`));
