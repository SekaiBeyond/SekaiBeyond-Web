import { HttpsError } from "firebase-functions/v2/https";

/**
 * The sections of a member's profile that others can be shown, and that the
 * member can switch off one at a time on the Settings tab of /profile.
 *
 * Name and photo are deliberately absent: a passport page exists to say whose
 * passport it is, and a page that named nobody would be indistinguishable from
 * the private notice it already has. Whoever wants that has the passport-page
 * switch (`hidePassportPage`), which is coarser on purpose.
 *
 * Mirrors PROFILE_SECTIONS in app/lib/privacy.ts.
 */
export const PROFILE_SECTIONS = ["badges", "events", "passports"] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Per-section visibility. `true` means other people see that section. */
export type ProfileVisibility = Record<ProfileSection, boolean>;

/**
 * Read the stored map, defaulting anything unset to visible.
 *
 * Absent means visible rather than hidden because every account predates the
 * setting: a profile nobody has touched has to keep reading the way it always
 * has, and only an explicit `false` takes a section away.
 */
export function readVisibility(raw: unknown): ProfileVisibility {
    const stored = (raw ?? {}) as Record<string, unknown>;
    const out = {} as ProfileVisibility;
    for (const section of PROFILE_SECTIONS) {
        out[section] = stored[section] !== false;
    }
    return out;
}

/**
 * Validate a partial update from the client. Only known sections are accepted,
 * each must be a boolean, and an empty object is rejected — a no-op write would
 * report success without the caller ever learning their key was misspelled.
 */
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
