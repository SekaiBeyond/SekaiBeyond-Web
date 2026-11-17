import { defineSecret } from "firebase-functions/params";
import { db } from "./firebase";

export interface GoogleBinding {
    sub: string;
    email: string;
    name: string;
    photoURL: string;
    signUpName: string;
}

export function credentialsRef(uid: string): FirebaseFirestore.DocumentReference {
    return db.collection("credentials").doc(uid);
}

export function googleIndexRef(sub: string): FirebaseFirestore.DocumentReference {
    return db.collection("googleIndex").doc(sub);
}

export function googleBindingOf(snap: FirebaseFirestore.DocumentSnapshot): GoogleBinding | null {
    const google: unknown = snap.get("google");
    return google && typeof google === "object" ? google as GoogleBinding : null;
}

export const PASSWORD_PEPPER = defineSecret("PASSWORD_PEPPER");

export function accountPepper(): string {
    if (process.env.FUNCTIONS_EMULATOR === "true") return "emulator-pepper";
    const pepper = PASSWORD_PEPPER.value();
    if (!pepper) throw new Error("PASSWORD_PEPPER is not set on this function.");
    return pepper;
}
