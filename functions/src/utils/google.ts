import { HttpsError } from "firebase-functions/v2/https";
import { OAuth2Client } from "google-auth-library";
import { normalizeEmail } from "./accountEmail";
import { GOOGLE_CLIENT_ID } from "./config";

/** Who Google says someone is. Their `sub` identifies them; the rest is only what Google has on file. */
export interface GoogleIdentity {
    sub: string;
    email: string;
    emailVerified: boolean;
    name: string;
    photoURL: string;
}

const client = new OAuth2Client();

// A Google ID token is a short JWT; this only stops a long string being parsed.
const MAX_TOKEN_LENGTH = 4096;

// Google's button can't reach the emulators, so the site's stand-in sends this,
// followed by the identity as JSON. Only accepted there: on a deployed function
// FUNCTIONS_EMULATOR is unset, and this is an ordinary bad token.
const EMULATOR_PREFIX = "emulator:";

const badToken = () => new HttpsError("unauthenticated", "Google sign-in failed.", {code: "bad-google-token"});

/** The identity in a Google sign-in's ID token, which is only trusted once checked here. */
export async function verifyGoogleToken(idToken: unknown): Promise<GoogleIdentity> {
    if (typeof idToken !== "string" || !idToken || idToken.length > MAX_TOKEN_LENGTH) throw badToken();

    if (process.env.FUNCTIONS_EMULATOR === "true" && idToken.startsWith(EMULATOR_PREFIX)) {
        return JSON.parse(idToken.slice(EMULATOR_PREFIX.length)) as GoogleIdentity;
    }

    if (!GOOGLE_CLIENT_ID) {
        console.error("verifyGoogleToken: GOOGLE_CLIENT_ID is not set.");
        throw badToken();
    }

    let payload;
    try {
        // Checks Google's signature, that it was issued for this site, by
        // Google, and that it hasn't expired.
        payload = (await client.verifyIdToken({idToken, audience: GOOGLE_CLIENT_ID})).getPayload();
    } catch {
        throw badToken();
    }
    if (!payload?.sub) throw badToken();

    return {
        sub: payload.sub,
        email: normalizeEmail(payload.email ?? ""),
        emailVerified: payload.email_verified === true,
        name: payload.name ?? "",
        photoURL: payload.picture ?? "",
    };
}
