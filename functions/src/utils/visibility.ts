import { HttpsError } from "firebase-functions/v2/https";

const PROFILE_SECTIONS = ["badges", "events", "passports"] as const;

type ProfileSection = (typeof PROFILE_SECTIONS)[number];

type ProfileVisibility = Record<ProfileSection, boolean>;

export function readVisibility(raw: unknown): ProfileVisibility {
    const stored = (raw ?? {}) as Record<string, unknown>;
    const out = {} as ProfileVisibility;
    for (const section of PROFILE_SECTIONS) {
        out[section] = stored[section] !== false;
    }
    return out;
}

export function parseVisibilityInput(raw: unknown): Partial<ProfileVisibility> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new HttpsError("invalid-argument", "sections must be an object.");
    }
    const input = raw as Record<string, unknown>;
    const out: Partial<ProfileVisibility> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!(PROFILE_SECTIONS as readonly string[]).includes(key)) {
            throw new HttpsError("invalid-argument", `Unknown profile section: ${key}.`);
        }
        if (typeof value !== "boolean") {
            throw new HttpsError("invalid-argument", `Section ${key} must be a boolean.`);
        }
        out[key as ProfileSection] = value;
    }
    if (Object.keys(out).length === 0) {
        throw new HttpsError("invalid-argument", "No sections given.");
    }
    return out;
}
