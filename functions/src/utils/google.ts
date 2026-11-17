import { HttpsError } from "firebase-functions/v2/https";
import { OAuth2Client } from "google-auth-library";
import { normalizeEmail } from "./accountEmail";
import { GOOGLE_CLIENT_ID } from "./config";

export interface GoogleIdentity {
    sub: string;
    email: string;
    emailVerified: boolean;
    name: string;
    photoURL: string;
}

const client = new OAuth2Client();

const MAX_TOKEN_LENGTH = 4096;

const EMULATOR_PREFIX = "emulator:";

const badToken = () => new HttpsError("unauthenticated", "Google sign-in failed.", {code: "bad-google-token"});

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
