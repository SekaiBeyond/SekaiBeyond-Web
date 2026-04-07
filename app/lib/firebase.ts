import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type Functions, getFunctions as _getFunctions, httpsCallable } from "firebase/functions";
import { type FirebaseStorage, getStorage } from "firebase/storage";

const requiredEnvVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
] as const;

const missing = requiredEnvVars.filter(key => !import.meta.env[key]);
if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;
let storage: FirebaseStorage;

function getFirebaseApp() {
    if (!app) {
        app = initializeApp(firebaseConfig);
    }
    return app;
}

export function getFirebaseAuth() {
    if (!auth) {
        auth = getAuth(getFirebaseApp());
    }
    return auth;
}

export function getFirebaseDb() {
    if (!db) {
        db = getFirestore(getFirebaseApp());
    }
    return db;
}

export function getFunctions() {
    if (!functions) {
        functions = _getFunctions(getFirebaseApp());
    }
    return functions;
}

export const callClaimEventCode = (data: {code: string}) =>
    httpsCallable<{code: string}, {eventId: string}>(getFunctions(), 'claimEventCode')(data);

export const callClaimBadgeActivationCode = (data: {code: string}) =>
    httpsCallable<{code: string}, {
        badgeId: string;
        badgeName: string;
        badgeNameCn: string;
        badgeDescription: string;
        badgeDescriptionCn: string;
        badgeImageUrl: string;
    }>(getFunctions(), 'claimBadgeActivationCode')(data);

export const callGenerateBadgeActivationCode = (data: {
    badgeId: string;
    maxUses: number;
    activeFrom?: string;
    activeUntil?: string;
}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateBadgeActivationCode'
    )(data);

export const callGenerateEventCode = (data: {
    eventId: string;
    activeFrom?: string;
    activeUntil?: string;
}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateEventCode'
    )(data);

export const callUploadAdminImage = async (file: File, storagePath: string): Promise<string> => {
    const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const result = await httpsCallable<
        {path: string; data: string; contentType: string},
        {url: string}
    >(getFunctions(), 'uploadAdminImage')({
        path: storagePath,
        data: base64,
        contentType: file.type,
    });
    return result.data.url;
};

export const callUploadAvatar = async (file: File): Promise<string> => {
    const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const result = await httpsCallable<
        {data: string; contentType: string},
        {url: string}
    >(getFunctions(), 'uploadAvatar')({
        data: base64,
        contentType: file.type,
    });
    return result.data.url;
};

export function getFirebaseStorage() {
    if (!storage) {
        storage = getStorage(getFirebaseApp());
    }
    return storage;
}

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(getFirebaseAuth(), googleProvider);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
