import { type FirebaseApp, FirebaseError, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
    type Auth,
    connectAuthEmulator,
    getAuth,
    signInWithCustomToken,
    signOut as firebaseSignOut,
} from "firebase/auth";
import { connectFirestoreEmulator, type Firestore, getFirestore } from "firebase/firestore";
import {
    connectFunctionsEmulator,
    type Functions,
    type FunctionsError,
    getFunctions as _getFunctions,
    httpsCallable,
} from "firebase/functions";
import type { Language } from "~/components/LanguageContextProvider";
import type { SocialLinks, TeamMemberConfig } from "./siteConfig";
import type { UploadLimits } from "./uploadLimits";
import type { ConContent } from "./conContent";
import type { PassportPublicProfile } from "./passports";
import type { ProfileVisibility } from "./privacy";
import type { AppPlatform } from "./appLinks";

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

export const USE_EMULATORS = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

const STORAGE_HOST = USE_EMULATORS ? '127.0.0.1:9199' : 'firebasestorage.googleapis.com';
export const isStorageUrl = (url: string | undefined) => url?.includes(STORAGE_HOST) ?? false;

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;

function getFirebaseApp() {
    if (!app) {
        app = initializeApp(firebaseConfig);

        if (typeof window !== "undefined") {
            const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

            if (import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN) {
                (self as {FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean}).FIREBASE_APPCHECK_DEBUG_TOKEN =
                    import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN === 'true'
                        ? true
                        : import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN;
            }

            if (siteKey && !USE_EMULATORS) {
                initializeAppCheck(app, {
                    provider: new ReCaptchaV3Provider(siteKey),
                    isTokenAutoRefreshEnabled: true,
                });
            }
        }
    }
    return app;
}

export function getFirebaseAuth() {
    if (!auth) {
        auth = getAuth(getFirebaseApp());
        if (USE_EMULATORS) connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
    }
    return auth;
}

export function getFirebaseDb() {
    if (!db) {
        db = getFirestore(getFirebaseApp());
        if (USE_EMULATORS) connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return db;
}

function getFunctions() {
    if (!functions) {
        functions = _getFunctions(getFirebaseApp());
        if (USE_EMULATORS) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    return functions;
}

export const EMAIL_CODE_LENGTH = 8;

export const callSendEmailCode = (data: {
    purpose: 'signup' | 'password' | 'email-change';
    email: string;
    language: Language;
}) =>
    httpsCallable<typeof data, {sent: boolean}>(getFunctions(), 'sendEmailCode')(data);

export const callSignUpWithEmail = (data: {email: string; code: string; displayName: string; password: string}) =>
    httpsCallable<typeof data, {token: string}>(getFunctions(), 'signUpWithEmail')(data);

export const callSignInWithPassword = (data: {email: string; password: string}) =>
    httpsCallable<typeof data, {token: string}>(getFunctions(), 'signInWithPassword')(data);

export const callResetPassword = (data: {email: string; code: string; password: string; language: Language}) =>
    httpsCallable<typeof data, {token: string}>(getFunctions(), 'resetPassword')(data);

export type GoogleSignIn =
    | {status: 'signed-in'; token: string}
    | {status: 'needs-account'; name: string; email: string; emailVerified: boolean; emailTaken: boolean};

export const callSignInWithGoogle = (data: {idToken: string}) =>
    httpsCallable<typeof data, GoogleSignIn>(getFunctions(), 'signInWithGoogle')(data);

export const callCreateAccountWithGoogle = (data: {
    idToken: string;
    displayName: string;
    email: string;
    code?: string;
    password?: string;
}) => httpsCallable<typeof data, {token: string}>(getFunctions(), 'createAccountWithGoogle')(data);

export const callBindGoogleWithPassword = (data: {
    idToken: string;
    email: string;
    password: string;
    language: Language;
}) =>
    httpsCallable<typeof data, {token: string}>(getFunctions(), 'bindGoogleWithPassword')(data);

export const callBindGoogle = (data: {idToken: string; language: Language}) =>
    httpsCallable<typeof data, {bound: boolean}>(getFunctions(), 'bindGoogle')(data);

export const callUnbindGoogle = (data: {language: Language}) =>
    httpsCallable<typeof data, {unbound: boolean}>(getFunctions(), 'unbindGoogle')(data);

export interface SignInMethods {
    hasPassword: boolean;
    googleEmail: string | null;
    emailChangeAllowedAt: string | null;
}

export const callGetSignInMethods = (data: {uid?: string} = {}) =>
    httpsCallable<typeof data, SignInMethods>(getFunctions(), 'getSignInMethods')(data);

export const callChangePassword = (data: {code: string; password: string; language: Language}) =>
    httpsCallable<typeof data, {token: string}>(getFunctions(), 'changePassword')(data);

export const callChangeEmail = (data: {email: string; code: string; language: Language}) =>
    httpsCallable<typeof data, {email: string}>(getFunctions(), 'changeEmail')(data);

export const callUndoEmailChange = (data: {token: string; password: string; language: Language}) =>
    httpsCallable<typeof data, {email: string}>(getFunctions(), 'undoEmailChange')(data);

export const callAdminChangeEmail = (data: {targetUid: string; email: string; language: Language}) =>
    httpsCallable<typeof data, {email: string}>(getFunctions(), 'adminChangeEmail')(data);

export const callTouchSession = () =>
    httpsCallable<Record<string, never>, {registered: boolean}>(getFunctions(), 'touchSession')({});

export const callEndSession = (data: {sessionId: string}) =>
    httpsCallable<typeof data, {ended: boolean}>(getFunctions(), 'endSession')(data);

const END_OWN_SESSION_TIMEOUT_MS = 4_000;

export const callEndOwnSession = () =>
    httpsCallable<Record<string, never>, {ended: boolean}>(getFunctions(), 'endSession', {
        timeout: END_OWN_SESSION_TIMEOUT_MS,
    })({});

export const callEndOtherSessions = () =>
    httpsCallable<Record<string, never>, {ended: number}>(getFunctions(), 'endOtherSessions')({});

export const callEndAllSessions = () =>
    httpsCallable<Record<string, never>, {ended: boolean}>(getFunctions(), 'endAllSessions')({});

export const callClaimEventCode = (data: {code: string}) =>
    httpsCallable<typeof data, {
        eventId: string;
        eventTitle: string;
        eventTitleCn: string;
        eventPoster: string;
    }>(getFunctions(), 'claimEventCode')(data);

type RedeemResult =
    | {
    kind: 'badge';
    badgeId: string;
    badgeName: string;
    badgeNameCn: string;
    badgeDescription: string;
    badgeDescriptionCn: string;
    badgeImageUrl: string;
}
    | {kind: 'staff'; eventTitle: string; eventTitleCn: string; eventPoster: string}
    | {
    kind: 'passport-claim';
    passportId: string;
    daysGranted: number;
    membershipExpiresAt: string;
    designName: string;
    designNameCn: string;
    coverImageUrl: string;
};

export const callRedeemCode = (data: {code: string; confirmEmailMismatch?: boolean}) =>
    httpsCallable<typeof data, RedeemResult>(getFunctions(), 'redeemCode')(data);

export const callGenerateBadgeActivationCode = (data: {
    badgeId: string;
    maxUses: number;
    activeFrom?: string;
    activeUntil?: string;
}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateBadgeActivationCode'
    )(data);

export const callGenerateEventCode = (data: {eventId: string}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateEventCode'
    )(data);

export const callRequestEventDeletion = (data: {eventId: string}) =>
    httpsCallable<typeof data, {deleteAt: string}>(getFunctions(), 'requestEventDeletion')(data);

export const callCancelEventDeletion = (data: {eventId: string}) =>
    httpsCallable<typeof data, {cancelled: boolean}>(getFunctions(), 'cancelEventDeletion')(data);

export const callRequestBadgeDeletion = (data: {badgeId: string}) =>
    httpsCallable<typeof data, {deleteAt: string}>(getFunctions(), 'requestBadgeDeletion')(data);

export const callCancelBadgeDeletion = (data: {badgeId: string}) =>
    httpsCallable<typeof data, {cancelled: boolean}>(getFunctions(), 'cancelBadgeDeletion')(data);

export const callChangeUserGroup = (data: {targetUid: string; newGroup: string; title?: string; titleCn?: string}) =>
    httpsCallable<typeof data, {oldGroup: string; newGroup: string}>(getFunctions(), 'changeUserGroup')(data);

export const callSetMembership = (data: {targetUid: string; expiresAt?: string | null; extendDays?: number}) =>
    httpsCallable<typeof data, {membershipExpiresAt: string | null}>(getFunctions(), 'setMembership')(data);

export const callBanUser = (data: {targetUid: string; until?: string | null; reason?: string}) =>
    httpsCallable<typeof data, {ban: {at: string; until: string | null; reason: string; byName: string}}>(
        getFunctions(), 'banUser',
    )(data);

export const callUnbanUser = (data: {targetUid: string}) =>
    httpsCallable<typeof data, {lifted: boolean}>(getFunctions(), 'unbanUser')(data);

export const callSetUserTitle = (data: {targetUid: string; title?: string; titleCn?: string}) =>
    httpsCallable<typeof data, {success: boolean}>(getFunctions(), 'setUserTitle')(data);

export const callSavePastEvent = (data: {
    eventId?: string;
    title: string; titleCn: string; tagIds: string[]; date: string;
    venueId: string; roomIds: string[];
    description: string; descriptionCn: string; icon: string;
    recapLink: string; recapLinkCn: string;
    con: boolean;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'savePastEvent')(data);

export const callSetPastEventPublished = (data: {eventId: string; published: boolean}) =>
    httpsCallable<typeof data, {published: boolean}>(getFunctions(), 'setPastEventPublished')(data);

export const callSaveUpcomingEvent = (data: {
    eventId?: string;
    title: string; titleCn: string; description: string; descriptionCn: string;
    venueId: string; roomIds: string[]; startAt: string; endAt: string;
    poster: string; emailHeaderBg: string; posterCredit: string;
    buyTicket: string; learnMore: string;
    customButtonText: string; customButtonTextCn: string; customButtonLink: string;
    paid: boolean;
    con: boolean;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'saveUpcomingEvent')(data);

export const callRequestUpcomingEventDeletion = (data: {eventId: string}) =>
    httpsCallable<typeof data, {deleteAt: string}>(getFunctions(), 'requestUpcomingEventDeletion')(data);

export const callCancelUpcomingEventDeletion = (data: {eventId: string}) =>
    httpsCallable<typeof data, {cancelled: boolean}>(getFunctions(), 'cancelUpcomingEventDeletion')(data);

export const callSetUpcomingEventPublished = (data: {eventId: string; published: boolean}) =>
    httpsCallable<typeof data, {published: boolean}>(getFunctions(), 'setUpcomingEventPublished')(data);

export const callArchiveUpcomingEvent = (data: {eventId: string; tagIds: string[]}) =>
    httpsCallable<typeof data, {pastEventId: string}>(getFunctions(), 'archiveUpcomingEvent')(data);

export const callImportEventAttendees = (data: {
    eventId: string;
    attendees: Array<{email: string; name: string; ticketCount: number; type: string; notes?: string}>;
    onDuplicate?: 'skip' | 'override';
}) => httpsCallable<typeof data, {added: number; replaced: number; skipped: number; total: number}>(
    getFunctions(), 'importEventAttendees')(data);

export const callAddWalkInAttendee = (data: {
    eventId: string;
    email: string;
    name: string;
    ticketCount: number;
    type: string;
    notes: string;
    checkIn: boolean;
}) => httpsCallable<typeof data, {attendeeId: string; checkedIn: boolean; userCheckedIn: boolean}>(
    getFunctions(), 'addWalkInAttendee')(data);

export const callImportHometownTickets = (data: {
    eventId: string;
    tickets: Array<{ticketId: string; name: string; email: string; type: string; orderId: string}>;
    updateExisting?: boolean;
    completeTicketIds?: string[];
    importId: string;
}) => httpsCallable<typeof data, {
    added: number;
    confirmed: number;
    updated: number;
    skipped: number;
    missing: number;
    restored: number;
}>(getFunctions(), 'importHometownTickets')(data);

export const callSyncHometownOrderTimes = (data: {
    eventId: string;
    orders: Array<{orderId: string; orderedAt: string}>;
    syncId: string;
}) => httpsCallable<typeof data, {synced: number; unchanged: number; unmatched: number}>(
    getFunctions(), 'syncHometownOrderTimes')(data);

export const callSetHometownAdmitUnlisted = (data: {eventId: string; enabled: boolean}) =>
    httpsCallable<typeof data, {enabled: boolean}>(getFunctions(), 'setHometownAdmitUnlisted')(data);

const REDEEM_TIMEOUT_MS = 20_000;

export const callRedeemTicket = (data: {eventId: string; ticketId: string}) =>
    httpsCallable<typeof data, {
        success?: boolean;
        alreadyRedeemed?: boolean;
        hometown?: boolean;
        unlisted?: boolean;
        missingFromHometown?: boolean;
        attendeeName: string;
        attendeeEmail: string;
        eventTitle: string;
        ticketIndex: number;
        ticketType: string;
        notes?: string;
        userCheckedIn?: boolean;
        redeemedBy?: string;
        redeemedAt?: string | null;
        graceRemainingMs?: number;
    }>(getFunctions(), 'redeemTicket', {timeout: REDEEM_TIMEOUT_MS})(data);

export interface HeldTicket {
    ticketId: string;
    type: string;
    redeemed: boolean;
    redeemedAt: string | null;
    voided: boolean;
}

export interface HeldTicketEvent {
    eventId: string;
    title: string;
    titleCn: string;
    location: string;
    locationCn: string;
    venueId: string;
    roomIds: string[];
    poster: string;
    startAt: string;
    tickets: HeldTicket[];
}

export const callGetMyTickets = () =>
    httpsCallable<Record<string, never>, {events: HeldTicketEvent[]}>(getFunctions(), 'getMyTickets')({});

export interface AttendeeAccount {
    email: string;
    uid?: string;
    displayName?: string;
}

export const callGetAttendeeAccounts = (data: {eventId: string; emails: string[]}) =>
    httpsCallable<typeof data, {accounts: AttendeeAccount[]}>(getFunctions(), 'getAttendeeAccounts')(data);

export const callVoidTicket = (data: {eventId: string; attendeeId: string; ticketId: string}) =>
    httpsCallable<typeof data, {voided: boolean}>(getFunctions(), 'voidTicket')(data);

export const callUnvoidTicket = (data: {eventId: string; attendeeId: string; ticketId: string}) =>
    httpsCallable<typeof data, {unvoided: boolean}>(getFunctions(), 'unvoidTicket')(data);

export const callAdminRedeemTicket = (data: {eventId: string; attendeeId: string; ticketId: string}) =>
    httpsCallable<typeof data, {redeemed: boolean; alreadyRedeemed?: boolean}>(
        getFunctions(), 'adminRedeemTicket')(data);

export const callResetTicket = (data: {eventId: string; attendeeId: string; ticketId: string}) =>
    httpsCallable<typeof data, {reset: boolean}>(getFunctions(), 'resetTicket')(data);

export const callDeleteEventAttendee = (data: {eventId: string; attendeeId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(
        getFunctions(), 'deleteEventAttendee')(data);

export const callUpdateEventAttendee = (data: {
    eventId: string;
    attendeeId: string;
    name: string;
    ticketCount: number;
    type: string;
    notes?: string;
}) => httpsCallable<typeof data, {updated: boolean; regenerated: boolean; notes?: string}>(
    getFunctions(), 'updateEventAttendee')(data);

export const callUpdateTicketType = (data: {
    eventId: string;
    attendeeId: string;
    ticketId: string;
    type: string;
}) => httpsCallable<typeof data, {updated: boolean}>(
    getFunctions(), 'updateTicketType')(data);

export const callUpdateTicketNotes = (data: {
    eventId: string;
    attendeeId: string;
    ticketId: string;
    notes: string;
}) => httpsCallable<typeof data, {updated: boolean; notes: string}>(
    getFunctions(), 'updateTicketNotes')(data);

export const callSendTicketEmails = (data: {
    eventId: string;
    mode?: 'unsent' | 'all';
    attendeeIds?: string[];
    cursor?: string;
}) => httpsCallable<typeof data, {
    sentCount: number;
    queuedCount: number;
    hasMore: boolean;
    nextCursor?: string;
}>(getFunctions(), 'sendTicketEmails')(data);

export interface TicketEmailQuota {
    sentToday: number;
    dailyCap: number;
    chunkSize: number;
    queuedCount: number;
    queueCap: number;
}

export const callGetTicketEmailQuota = () =>
    httpsCallable<Record<string, never>, TicketEmailQuota>(getFunctions(), 'getTicketEmailQuota')({});

export interface EmailQuotaStatus {
    provider: {
        name: string;
        windowKind: 'rolling24h' | 'calendarDay';
        fromAddress: string;
    };
    providerReported: number | null;
    readingSource: 'live' | 'cached' | 'unavailable';
    usageTruncated: boolean;
    sentToday: number;
    dailyCap: number;
    confirmed: number;
    reserved: number;
    observedAt: string | null;
    queuedCount: number;
    oldestQueuedAt: string | null;
    queueCap: number;
    drainIntervalMinutes: number;
    serverNow: string;
}

export const callGetEmailQuotaStatus = () =>
    httpsCallable<Record<string, never>, EmailQuotaStatus>(getFunctions(), 'getEmailQuotaStatus')({});

export interface WalletPassStatus {
    configured: boolean;
    month: string;
    used: number;
    cap: number;
    limit: number;
    perTicketDailyCap: number;
    observedAt: string | null;
    provider: {
        count: number;
        limit: number;
        remaining: number;
        resetDate: string;
        plan: string;
        trialExpiresAt: string | null;
    } | null;
    readingSource: 'live' | 'cached' | 'unavailable';
    serverNow: string;
}

export const callGetWalletPassStatus = () =>
    httpsCallable<Record<string, never>, WalletPassStatus>(getFunctions(), 'getWalletPassStatus')({});

export const API_SCOPES = [
    'events:read', 'team:read', 'event-staff:read', 'tickets:read', 'tickets:write', 'account-links',
] as const;
export type ApiScope = typeof API_SCOPES[number];

export interface ApiKeySummary {
    id: string;
    appId: string;
    name: string;
    hint: string;
    scopes: ApiScope[];
    eventIds: string[];
    createdByName: string;
    createdAt: string | null;
    expiresAt: string | null;
    lastUsedAt: string | null;
}

export const callCreateApiKey = (data: {
    appId: string;
    name: string;
    scopes: ApiScope[];
    eventIds: string[];
    expiresInDays: number;
}) => httpsCallable<typeof data, {id: string; key: string; hint: string; expiresAt: string}>(
    getFunctions(), 'createApiKey')(data);

export const callRenameApiKey = (data: {keyId: string; name: string}) =>
    httpsCallable<typeof data, {name: string}>(getFunctions(), 'renameApiKey')(data);

export const callRevokeApiKey = (data: {keyId: string}) =>
    httpsCallable<typeof data, {revoked: boolean}>(getFunctions(), 'revokeApiKey')(data);

export const APP_ID_RE = /^[a-z0-9-]{1,32}$/;

export const APP_MAINTAINERS_MAX = 5;

export interface AppPerson {
    uid: string;
    name: string;
    photoURL: string;
    deleted: boolean;
}

export interface AppSummary {
    id: string;
    nameEn: string;
    nameCn: string;
    creator: AppPerson | null;
    maintainers: AppPerson[];
    redirectUris: string[];
    firebaseProjectId: string;
    serviceAccount: string;
    accountLinking: boolean;
    platform: AppPlatform;
    iconUrl: string;
    keys: ApiKeySummary[];
    createdAt: string | null;
    updatedAt: string | null;
}

interface AppFields {
    nameEn: string;
    nameCn: string;
    maintainerUids: string[];
    redirectUris: string[];
    firebaseProjectId: string;
    serviceAccount: string;
    accountLinking: boolean;
    platform: AppPlatform;
    iconUrl: string;
}

export const callListApps = () =>
    httpsCallable<Record<string, never>, {apps: AppSummary[]; signer: string; serverNow: string}>(
        getFunctions(), 'listApps')({});

export const callSaveApp = (data: AppFields & ({create: true} | {appId: string; create: false})) =>
    httpsCallable<typeof data, {saved: boolean; appId: string}>(getFunctions(), 'saveApp')(data);

export const callDeleteApp = (data: {appId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteApp')(data);

export interface LinkableApp {
    appId: string;
    nameEn: string;
    nameCn: string;
    platform: AppPlatform;
    iconUrl: string;
    accountLinking: boolean;
    link: {appUserName: string; linkedAt: string | null} | null;
}

export const callGetAppLinks = () =>
    httpsCallable<Record<string, never>, {apps: LinkableApp[]}>(getFunctions(), 'getAppLinks')({});

export const callStartAppLink = (data: {appId: string}) =>
    httpsCallable<typeof data, {requestId: string; code: string; qr: string; expiresAt: string; serverTime: string}>(
        getFunctions(), 'startAppLink')(data);

export const callConfirmAppLink = (data: {requestId: string; code: string; language: Language}) =>
    httpsCallable<typeof data, {linked: boolean}>(getFunctions(), 'confirmAppLink')(data);

export const callCancelAppLink = (data: {requestId: string}) =>
    httpsCallable<typeof data, {cancelled: boolean}>(getFunctions(), 'cancelAppLink')(data);

export const callRemoveAppLink = (data: {appId: string; language: Language}) =>
    httpsCallable<typeof data, {unlinked: boolean}>(getFunctions(), 'removeAppLink')(data);

export const callUndoAppLink = (data: {token: string; password: string}) =>
    httpsCallable<typeof data, {appId: string; nameEn: string; nameCn: string; heldUntil: string | null}>(
        getFunctions(), 'undoAppLink')(data);

export interface UserAppLink {
    appId: string;
    nameEn: string;
    nameCn: string;
    platform: AppPlatform;
    iconUrl: string;
    accountLinking: boolean;
    link: {appUserId: string; appUserName: string; linkedAt: string | null} | null;
    hold: {appUserId: string; until: string} | null;
}

export const callGetUserAppLinks = (data: {uid: string}) =>
    httpsCallable<typeof data, {apps: UserAppLink[]}>(getFunctions(), 'getUserAppLinks')(data);

export const callClearAppLinkHold = (data: {targetUid: string; appId: string}) =>
    httpsCallable<typeof data, {cleared: boolean}>(getFunctions(), 'clearAppLinkHold')(data);

export const callGetAppSignInInfo = (data: {appId: string; redirectUri?: string}) =>
    httpsCallable<typeof data, {nameEn: string; nameCn: string; iconUrl: string; maintainerNames: string[]}>(
        getFunctions(), 'getAppSignInInfo')(data);

export const callIssueAppCode = (data: {appId: string; redirectUri?: string; codeChallenge: string}) =>
    httpsCallable<typeof data, {code: string; redirectUri: string}>(getFunctions(), 'issueAppCode')(data);

export const callUpdateEventEmailTemplate = (data: {
    eventId: string;
    subject: string;
    bodyHtml: string;
}) => httpsCallable<typeof data, {saved: boolean}>(
    getFunctions(), 'updateEventEmailTemplate')(data);

export const callUpdateWalletPassSettings = (data: {
    eventId: string;
    enabled: boolean;
    color: string;
    headerText: string;
    notes: {label: string; value: string}[];
}) => httpsCallable<typeof data, {saved: boolean}>(
    getFunctions(), 'updateWalletPassSettings')(data);

export const callAssignEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {added: boolean; attendeeRemoved: boolean}>(
        getFunctions(), 'assignEventStaff')(data);

export const callRemoveEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {removed: boolean}>(getFunctions(), 'removeEventStaff')(data);

export const callGetEventStaff = (data: {eventId: string}) =>
    httpsCallable<typeof data, {
        staff: {uid: string; displayName: string; photoURL: string; group: string; title: string; titleCn: string}[];
    }>(getFunctions(), 'getEventStaff')(data);

export const callSavePolicy = (data: {contentEn: string; contentCn: string}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'savePolicy')(data);

export const callSaveSiteConfig = (data: {
    contactEmail?: string;
    socialLinks?: SocialLinks;
    senderPrefix?: string;
}) =>
    httpsCallable<typeof data, {saved: boolean; socialLinks?: SocialLinks}>(getFunctions(), 'saveSiteConfig')(data);

export const callSaveConContent = (data: Partial<ConContent>) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveConContent')(data);

export const callSaveTeamMembers = (data: {teamMembers: TeamMemberConfig[]}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveTeamMembers')(data);

export const callGetPublicTeamMembers = () =>
    httpsCallable<Record<string, never>, {teamMembers: TeamMemberConfig[]}>(getFunctions(), 'getPublicTeamMembers')({});

export const callGetSenderSettings = () =>
    httpsCallable<Record<string, never>, {
        domain: string;
        defaultPrefix: string
    }>(getFunctions(), 'getSenderSettings')({});

export const callGetTeamRoster = () =>
    httpsCallable<Record<string, never>, {teamMembers: TeamMemberConfig[]}>(getFunctions(), 'getTeamRoster')({});

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

export const callGenerateStaffCode = (data: {eventId: string}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateStaffCode'
    )(data);

export const callToggleStaffCodeActive = (data: {codeId: string; active: boolean}) =>
    httpsCallable<typeof data, {active: boolean}>(getFunctions(), 'toggleStaffCodeActive')(data);

export const callDeleteStaffCode = (data: {codeId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteStaffCode')(data);

export const callSaveStaffCodeTimeWindow = (data: {
    codeId: string;
    activeFrom?: string | null;
    activeUntil?: string | null;
    maxUses?: number;
}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveStaffCodeTimeWindow')(data);

export const callSaveTag = (data: {tagId?: string; name: string; nameCn: string}) =>
    httpsCallable<typeof data, {tagId: string}>(getFunctions(), 'saveTag')(data);

export const callDeleteTag = (data: {tagId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteTag')(data);

export const callSaveVenue = (data: {
    venueId?: string;
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    buildingCode: string;
    suggestedLots: Array<{code: string; noteEn: string; noteCn: string}>;
    rooms: Array<{id: string; nameEn: string; nameCn: string}>;
}) => httpsCallable<typeof data, {
    venueId: string;
    eventsChanged: number;
}>(getFunctions(), 'saveVenue')(data);

export interface UwBuildingLookup {
    building: {code: string; name: string; address: string; lat: number; lng: number; parkingTip: string};
    recommendedLots: string[];
    nearestLots: Array<{code: string; seconds: number}>;
}

export const callLookUpUwBuilding = (data: {code: string}) =>
    httpsCallable<typeof data, UwBuildingLookup>(getFunctions(), 'lookUpUwBuilding')(data);

export const callSyncUwParking = () =>
    httpsCallable<Record<string, never>, {
        lotCount: number;
        pricingDayCount: number;
        walkingVenueCount: number;
        errors: string[];
    }>(getFunctions(), 'syncUwParking', {timeout: 300_000})({});

export const callDeleteVenue = (data: {venueId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteVenue')(data);

export const callSaveQrCode = (data: {
    qrId?: string;
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    platforms: string[];
    expirationMode: 'none' | 'event' | 'date';
    expiresAt?: string;
    lat?: number;
    lng?: number;
    spotLabel: string;
    spotLabelCn: string;
}) => httpsCallable<typeof data, {qrId: string}>(getFunctions(), 'saveQrCode')(data);

export const callSetQrSpot = (data: {qrId: string; lat: number; lng: number}) =>
    httpsCallable<typeof data, {lat: number; lng: number}>(getFunctions(), 'setQrSpot')(data);

export const callDeleteQrCode = (data: {qrId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteQrCode')(data);

export const callRecordQrScan = (data: {id: string; p?: string}) =>
    httpsCallable<typeof data, {active: boolean; targetUrl: string}>(getFunctions(), 'recordQrScan')(data);

export const callSaveSocialPlatform = (data: {
    id?: string;
    label: string;
    labelCn: string;
    order: number;
}) => httpsCallable<typeof data, {id: string}>(getFunctions(), 'saveSocialPlatform')(data);

export const callDeleteSocialPlatform = (data: {id: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteSocialPlatform')(data);

export const callSeedSocialPlatforms = () =>
    httpsCallable<Record<string, never>, {seeded: number}>(getFunctions(), 'seedSocialPlatforms')({});

export const callGeneratePassports = (data: {designId: string; count: number; note: string}) =>
    httpsCallable<typeof data, {
        designId: string;
        year: number;
        passports: Array<{passportId: string; activationCode: string}>;
    }>(getFunctions(), 'generatePassports')(data);

export const callReissuePassportKey = (data: {passportId: string}) =>
    httpsCallable<typeof data, {passportId: string; activationCode: string}>(
        getFunctions(), 'reissuePassportKey')(data);

export const callRevealPassportKey = (data: {passportId: string}) =>
    httpsCallable<typeof data, {passportId: string; activationCode: string}>(
        getFunctions(), 'revealPassportKey')(data);

export const callExportPassportKeys = (data: {passportIds: string[]}) =>
    httpsCallable<typeof data, {
        passports: Array<{passportId: string; activationCode: string}>;
        missing: string[];
    }>(getFunctions(), 'exportPassportKeys')(data);

export const callGetPassportPublicProfile = (data: {passportId: string}) =>
    httpsCallable<typeof data, PassportPublicProfile>(getFunctions(), 'getPassportPublicProfile')(data);

export const callDeletePassports = (data: {passportIds: string[]}) =>
    httpsCallable<typeof data, {
        deleted: string[];
        claimed: string[];
        missing: string[];
    }>(getFunctions(), 'deletePassports')(data);

export const callDeleteClaimedPassport = (data: {passportId: string; subtractDays: boolean}) =>
    httpsCallable<typeof data, {
        daysRemoved: number;
        nothingToSubtract: boolean;
    }>(getFunctions(), 'deleteClaimedPassport')(data);

export const callSetPassportNote = (data: {passportId: string; note: string}) =>
    httpsCallable<typeof data, {note: string; updated: boolean}>(getFunctions(), 'setPassportNote')(data);

export const callGetMyPassports = () =>
    httpsCallable<Record<string, never>, {
        passports: {id: string; designId: string; year: number; claimedAt: string | null}[];
    }>(getFunctions(), 'getMyPassports')({});

export const callSetPassportPrivacy = (data: {hide: boolean}) =>
    httpsCallable<typeof data, {hidePassportPage: boolean}>(getFunctions(), 'setPassportPrivacy')(data);

export const callSetProfileVisibility = (data: {sections: Partial<ProfileVisibility>}) =>
    httpsCallable<typeof data, {visibility: ProfileVisibility}>(getFunctions(), 'setProfileVisibility')(data);

export const callSavePassportDesign = (data: {
    designId?: string;
    year?: number;
    name: string;
    nameCn: string;
    coverImageUrl: string;
    outerCoverImageUrl: string;
    termDays: number;
}) => httpsCallable<typeof data, {designId: string}>(getFunctions(), 'savePassportDesign')(data);

export const callDeletePassportDesign = (data: {designId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deletePassportDesign')(data);

export const callEmailPassports = (data: {designId: string; emails: string[]; note: string}) =>
    httpsCallable<typeof data, {
        sentCount: number;
        queuedCount: number;
        deferred: string[];
        failed: string[];
    }>(getFunctions(), 'emailPassports')(data);

export const callUpdatePassportEmailTemplate = (data: {subject: string; bodyHtml: string}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'updatePassportEmailTemplate')(data);

export const callGetPublicProfile = (data: {uid: string}) =>
    httpsCallable<typeof data, {
        displayName: string; photoURL: string; bannerURL: string; joinedAt: string;
        attendedEvents: string[]; eventStaffEvents: string[];
        badges: string[];
        badgeEarnedAt: Record<string, string>;
        passports: {id: string; designId: string; year: number; claimedAt: string | null}[];
        passportPageHidden: boolean;
        group: string;
        isMember: boolean;
        title?: string;
        titleCn?: string;
        visibility: {badges: boolean; events: boolean; passports: boolean};
    }>(getFunctions(), 'getPublicProfile')(data);

export const callGetGoogleProfile = (data: {uid: string}) =>
    httpsCallable<typeof data, {name: string; signUpName: string; photoURL: string} | null>(
        getFunctions(), 'getGoogleProfile')(data);

const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

const uploadFile = async (name: string, file: File, fields: Record<string, string | undefined> = {}) => {
    const data = await readFileAsBase64(file);
    const result = await httpsCallable<Record<string, string | undefined>, {url: string}>(getFunctions(), name)({
        ...fields,
        data,
        contentType: file.type,
    });
    return result.data.url;
};

export const callUploadAdminImage = (file: File, storagePath: string): Promise<string> =>
    uploadFile('uploadAdminImage', file, {path: storagePath});

export const callUploadConVideo = (file: File, storagePath: string): Promise<string> =>
    uploadFile('uploadConVideo', file, {path: storagePath});

export const callGetUploadLimits = () =>
    httpsCallable<Record<string, never>, UploadLimits>(getFunctions(), 'getUploadLimits')({});

export const callUpdateDisplayName = (data: {displayName: string; targetUid?: string}) =>
    httpsCallable<typeof data, {displayName: string}>(getFunctions(), 'updateDisplayName')(data);

export const callDeleteAvatar = (data: {targetUid?: string} = {}) =>
    httpsCallable<typeof data, {photoURL: string}>(getFunctions(), 'deleteAvatar')(data);

export const callRequestAccountDeletion = (data: {targetUid?: string; language?: Language} = {}) =>
    httpsCallable<typeof data, {deleteAt: string}>(getFunctions(), 'requestAccountDeletion')(data);

export const callCancelAccountDeletion = (data: {targetUid?: string} = {}) =>
    httpsCallable<typeof data, {cancelled: boolean}>(getFunctions(), 'cancelAccountDeletion')(data);

export const callUploadAvatar = (file: File, targetUid?: string): Promise<string> =>
    uploadFile('uploadAvatar', file, {targetUid});

export const callUploadBanner = (file: File): Promise<string> => uploadFile('uploadBanner', file);

export const callDeleteBanner = (data: {targetUid?: string} = {}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteBanner')(data);

export const functionsErrorDetails = <T = unknown>(err: unknown): T | null => {
    if (err instanceof FirebaseError && "details" in err) {
        return ((err as FunctionsError).details as T | undefined) ?? null;
    }
    return null;
};

export const functionsErrorCode = (err: unknown): string | null =>
    functionsErrorDetails<{code?: string}>(err)?.code ?? null;

export const errorCode = (err: unknown): string | null =>
    functionsErrorCode(err) ?? (err instanceof FirebaseError ? err.code : null);

export const errorSuffix = (err: unknown, isEnglish: boolean): string => {
    const code = errorCode(err);
    if (!code) return '';
    return isEnglish ? ` (${code})` : `（${code}）`;
};

export const errorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback;

export const signInWithToken = (token: string) => signInWithCustomToken(getFirebaseAuth(), token);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
