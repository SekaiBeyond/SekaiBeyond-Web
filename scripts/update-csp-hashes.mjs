import {readFileSync, writeFileSync} from "fs";
import {createHash} from "crypto";

const html = readFileSync("build/client/index.html", "utf-8");

// Extract inline script contents (skip scripts with src attributes)
const scriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
const hashes = [];
let match;

while ((match = scriptRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const content = match[1];

    // Skip external scripts (have src attribute) and empty scripts
    if (/\ssrc\s*=/i.test(fullTag) || !content.trim()) continue;

    const hash = createHash("sha256").update(content).digest("base64");
    hashes.push(`'sha256-${hash}'`);
}

// Update firebase.json CSP
const firebasePath = "firebase.json";
const firebase = JSON.parse(readFileSync(firebasePath, "utf-8"));

for (const rule of firebase.hosting.headers) {
    for (const header of rule.headers) {
        if (header.key === "Content-Security-Policy") {
            // Replace script-src directive, preserving everything after it
            header.value = header.value.replace(
                /script-src\s+[^;]+/,
                `script-src 'self' ${hashes.join(" ")}`
            );
        }
    }
}

writeFileSync(firebasePath, JSON.stringify(firebase, null, 2) + "\n");
console.log(`Updated CSP with ${hashes.length} inline script hashes:`);
hashes.forEach((h) => console.log(`  ${h}`));
