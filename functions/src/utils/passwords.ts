import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { accountPepper } from "./credentials";

/**
 * Passwords are stored as Argon2id hashes, salted per password and peppered with
 * a secret kept outside the database, at OWASP's recommended settings. Each hash
 * says which settings made it, so these can go up without breaking old ones.
 */

const SETTINGS = {memory: 19_456, passes: 2, parallelism: 1};
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const MIN_LENGTH = 8;
// A ceiling rather than a rule of its own: hashing an endless string is a way
// to make a function work for free.
const MAX_LENGTH = 128;

interface Settings {
    memory: number;
    passes: number;
    parallelism: number;
}

const derive = (password: string, salt: Buffer, settings: Settings): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        argon2("argon2id", {
            // So the same password typed on a different keyboard, full-width
            // letters from an IME say, still matches.
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

// Stands in for a hash when an address has no password, so that answer takes as
// long as a wrong password does and gives nothing away.
const DECOY = encode(SETTINGS, Buffer.alloc(SALT_BYTES), Buffer.alloc(HASH_BYTES));

/** Whether `password` matches `stored`, or does the same work and says no when there's nothing stored. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
    const [, , params, salt, hash] = (stored || DECOY).split("$");
    const [memory, passes, parallelism] = params.split(",").map(part => Number(part.slice(2)));
    const expected = Buffer.from(hash, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"), {memory, passes, parallelism});
    return !!stored && timingSafeEqual(actual, expected);
}

const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const BREACH_CHECK_TIMEOUT_MS = 3_000;

/**
 * Whether `password` is on Have I Been Pwned's list of passwords from known
 * breaches, which is the first thing anyone guessing tries. Only the first 5
 * characters of its SHA-1 leave here (their k-anonymity range search), padded so
 * the answer's size says nothing either. Says no when the list can't be reached
 * in time: it's a guard against a bad choice, and nobody should be stuck at
 * sign-up over it.
 */
async function isBreached(password: string): Promise<boolean> {
    const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const suffix = hash.slice(5);
    try {
        const response = await fetch(BREACH_RANGE_URL + hash.slice(0, 5), {
            headers: {"Add-Padding": "true"},
            signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // One "SUFFIX:COUNT" a line; padding lines have a count of 0.
        return (await response.text()).split("\n").some(line => {
            const [candidate, count] = line.trim().split(":");
            return candidate === suffix && Number(count) > 0;
        });
    } catch (err) {
        console.warn("isBreached: breach list unavailable, password allowed", err);
        return false;
    }
}

/** The password to set, refused unless it's a string of a sensible length. */
function validateNewPassword(value: unknown): string {
    if (typeof value !== "string" || value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
        throw new HttpsError("invalid-argument", `Passwords are ${MIN_LENGTH} to ${MAX_LENGTH} characters.`, {
            code: "weak-password",
        });
    }
    return value;
}

/**
 * The password to set: a string of a sensible length that isn't known from a
 * breach. Checked as it will be hashed (see derive).
 */
export async function checkNewPassword(value: unknown): Promise<string> {
    const password = validateNewPassword(value);
    if (await isBreached(password.normalize("NFKC"))) {
        throw new HttpsError("invalid-argument", "That password has appeared in a data breach. Please choose another.", {
            code: "breached-password",
        });
    }
    return password;
}

/** A password being tried, which only has to fit what hashing will accept. */
export function readPasswordAttempt(value: unknown): string {
    return typeof value === "string" ? value.slice(0, MAX_LENGTH) : "";
}
