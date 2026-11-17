import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { accountPepper } from "./credentials";

const SETTINGS = {memory: 19_456, passes: 2, parallelism: 1};
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

interface Settings {
    memory: number;
    passes: number;
    parallelism: number;
}

const derive = (password: string, salt: Buffer, settings: Settings): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        argon2("argon2id", {
            message: password.normalize("NFKC"),
            nonce: salt,
            secret: Buffer.from(accountPepper()),
            tagLength: HASH_BYTES,
            ...settings,
        }, (err, key) => err ? reject(err) : resolve(key));
    });

const encode = (settings: Settings, salt: Buffer, hash: Buffer): string =>
    `$argon2id$m=${settings.memory},t=${settings.passes},p=${settings.parallelism}`
    + `$${salt.toString("base64")}$${hash.toString("base64")}`;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    return encode(SETTINGS, salt, await derive(password, salt, SETTINGS));
}

const DECOY = encode(SETTINGS, Buffer.alloc(SALT_BYTES), Buffer.alloc(HASH_BYTES));

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
    const [, , params, salt, hash] = (stored || DECOY).split("$");
    const [memory, passes, parallelism] = params.split(",").map(part => Number(part.slice(2)));
    const expected = Buffer.from(hash, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"), {memory, passes, parallelism});
    return !!stored && timingSafeEqual(actual, expected);
}

const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const BREACH_CHECK_TIMEOUT_MS = 3_000;

async function isBreached(password: string): Promise<boolean> {
    const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const suffix = hash.slice(5);
    try {
        const response = await fetch(BREACH_RANGE_URL + hash.slice(0, 5), {
            headers: {"Add-Padding": "true"},
            signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.text()).split("\n").some(line => {
            const [candidate, count] = line.trim().split(":");
            return candidate === suffix && Number(count) > 0;
        });
    } catch (err) {
        console.warn("isBreached: breach list unavailable, password allowed", err);
        return false;
    }
}

function validateNewPassword(value: unknown): string {
    if (typeof value !== "string" || value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
        throw new HttpsError("invalid-argument", `Passwords are ${MIN_LENGTH} to ${MAX_LENGTH} characters.`, {
            code: "weak-password",
        });
    }
    return value;
}

export async function checkNewPassword(value: unknown): Promise<string> {
    const password = validateNewPassword(value);
    if (await isBreached(password.normalize("NFKC"))) {
        throw new HttpsError("invalid-argument", "That password has appeared in a data breach. Please choose another.", {
            code: "breached-password",
        });
    }
    return password;
}

export function readPasswordAttempt(value: unknown): string {
    return typeof value === "string" ? value.slice(0, MAX_LENGTH) : "";
}
