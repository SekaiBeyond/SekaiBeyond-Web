import { db } from "./firebase";

/**
 * How an account signs in, kept apart from users/{uid} because all staff can
 * read that: credentials/{uid} is server-only, like passportSecrets, and holds
 * the password hash and the Google account bound to it.
 *
 * googleIndex holds one doc per Google account bound, named by Google's `sub`,
 * so a Google account can only be bound to one of ours. `sub` is the identity:
 * an address on a Google account can change hands, and `sub` is never reused.
 */

export interface GoogleBinding {
    sub: string;
    email: string;
    /** Google's latest name and photo, brought up to date at each sign-in. */
    name: string;
    photoURL: string;
    /** The name when it was bound, which the profile may have started as. */
    signUpName: string;
}

export function credentialsRef(uid: string): FirebaseFirestore.DocumentReference {
    return db.collection("credentials").doc(uid);
}

export function googleIndexRef(sub: string): FirebaseFirestore.DocumentReference {
    return db.collection("googleIndex").doc(sub);
}

/** The Google account bound to a credentials doc, or null without one. */
export function googleBindingOf(snap: FirebaseFirestore.DocumentSnapshot): GoogleBinding | null {
    const google: unknown = snap.get("google");
    return google && typeof google === "object" ? google as GoogleBinding : null;
}
