import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type Functions, getFunctions as _getFunctions, httpsCallable } from "firebase/functions";

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

export const callCreateUserProfile = () =>
    httpsCallable<Record<string, never>, {alreadyExists: boolean}>(getFunctions(), 'createUserProfile')({});

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

export const callDeleteEvent = (data: {eventId: string}) =>
    httpsCallable<{eventId: string}, {deleted: boolean}>(getFunctions(), 'deleteEvent')(data);

export const callDeleteBadge = (data: {badgeId: string}) =>
    httpsCallable<{badgeId: string}, {deleted: boolean}>(getFunctions(), 'deleteBadge')(data);

export const callChangeUserGroup = (data: {targetUid: string; newGroup: string}) =>
    httpsCallable<{targetUid: string; newGroup: string}, {oldGroup: string; newGroup: string}>(
        getFunctions(), 'changeUserGroup'
    )(data);

export const callSavePastEvent = (data: {
    eventId?: string;
    title: string; titleCn: string; tagId: string; date: string;
    location: string; description: string; descriptionCn: string; icon: string;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'savePastEvent')(data);

export const callSaveUpcomingEvent = (data: {
    eventId?: string;
    name: string; nameCn: string; description: string; descriptionCn: string;
    location: string; locationCn: string; startAt: string; endAt: string;
    poster: string; posterCredit: string; buyTicket: string; learnMore: string;
    customButtonText: string; customButtonTextCn: string; customButtonLink: string;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'saveUpcomingEvent')(data);

export const callDeleteUpcomingEvent = (data: {eventId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteUpcomingEvent')(data);

export const callArchiveUpcomingEvent = (data: {eventId: string; tagId: string}) =>
    httpsCallable<typeof data, {pastEventId: string}>(getFunctions(), 'archiveUpcomingEvent')(data);

export const callSaveBadge = (data: {
    badgeId?: string;
    name: string; nameCn: string; description: string; descriptionCn: string;
    imageUrl: string; createdByUid: string; createdByName: string; createdByLink: string;
}) => httpsCallable<typeof data, {badgeId: string}>(getFunctions(), 'saveBadge')(data);

export const callToggleAttendance = (data: {targetUid: string; eventId: string; grant: boolean}) =>
    httpsCallable<typeof data, {granted: boolean}>(getFunctions(), 'toggleAttendance')(data);

export const callToggleUserBadge = (data: {targetUid: string; badgeId: string; grant: boolean}) =>
    httpsCallable<typeof data, {granted: boolean}>(getFunctions(), 'toggleUserBadge')(data);

export const callToggleClaimCodeActive = (data: {codeId: string; active: boolean}) =>
    httpsCallable<typeof data, {active: boolean}>(getFunctions(), 'toggleClaimCodeActive')(data);

export const callSaveClaimCodeTimeWindow = (data: {
    codeId: string;
    activeFrom?: string | null;
    activeUntil?: string | null
}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveClaimCodeTimeWindow')(data);

export const callToggleBadgeCodeActive = (data: {codeId: string; active: boolean}) =>
    httpsCallable<typeof data, {active: boolean}>(getFunctions(), 'toggleBadgeCodeActive')(data);

export const callDeleteBadgeActivationCode = (data: {codeId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteBadgeActivationCode')(data);

export const callSaveTag = (data: {tagId?: string; name: string; nameCn: string}) =>
    httpsCallable<typeof data, {tagId: string}>(getFunctions(), 'saveTag')(data);

export const callDeleteTag = (data: {tagId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteTag')(data);

export const callGetPublicProfile = (data: {uid: string}) =>
    httpsCallable<{uid: string}, {
        displayName: string; photoURL: string; joinedAt: string;
        attendedEvents: string[]; badges: string[]; group: string;
    }>(getFunctions(), 'getPublicProfile')(data);

export const callDeleteAdminImage = async (downloadUrl: string): Promise<void> => {
    const match = downloadUrl.match(/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/);
    if (!match) return;
    const path = decodeURIComponent(match[1]);
    await httpsCallable<{path: string}, {deleted: boolean}>(
        getFunctions(), 'deleteAdminImage'
    )({path});
};

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

export const callUpdateDisplayName = (data: {displayName: string}) =>
    httpsCallable<{displayName: string}, {displayName: string}>(getFunctions(), 'updateDisplayName')(data);

export const callDeleteAvatar = () =>
    httpsCallable<Record<string, never>, {photoURL: string}>(getFunctions(), 'deleteAvatar')({});

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

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(getFirebaseAuth(), googleProvider);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
