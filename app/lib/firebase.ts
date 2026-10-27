import { type FirebaseApp, FirebaseError, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
    type Auth,
    connectAuthEmulator,
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
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
import type { ConEdition, SocialLinks, TeamMemberConfig } from "./siteConfig";
import type { UploadLimits } from "./uploadLimits";
import type { ConContent } from "./conContent";
import type { PassportPublicProfile } from "./passports";
import type { ProfileVisibility } from "./privacy";

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

// Points the site at the local emulators (Auth, Firestore and Functions on their
// default ports), as npm run dev does through .env.emulator. App Check stays
// off, and the emulated functions don't enforce it.
const USE_EMULATORS = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

// Whether a URL is a file uploaded to Storage, rather than, say, a Google photo.
// The Storage emulator serves its files from its own port.
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

            // 'true' generates a debug token in the console; anything else is
            // used as the token.
            if (import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN) {
                (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
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

export const callCreateUserProfile = () =>
    httpsCallable<Record<string, never>, {alreadyExists: boolean}>(getFunctions(), 'createUserProfile')({});

export const callClaimEventCode = (data: {code: string}) =>
    httpsCallable<{code: string}, {
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

export const callRedeemCode = (data: {code: string}) =>
    httpsCallable<{code: string}, RedeemResult>(getFunctions(), 'redeemCode')(data);

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
    httpsCallable<{eventId: string}, {deleteAt: string}>(getFunctions(), 'requestEventDeletion')(data);

export const callCancelEventDeletion = (data: {eventId: string}) =>
    httpsCallable<{eventId: string}, {cancelled: boolean}>(getFunctions(), 'cancelEventDeletion')(data);

export const callRequestBadgeDeletion = (data: {badgeId: string}) =>
    httpsCallable<{badgeId: string}, {deleteAt: string}>(getFunctions(), 'requestBadgeDeletion')(data);

export const callCancelBadgeDeletion = (data: {badgeId: string}) =>
    httpsCallable<{badgeId: string}, {cancelled: boolean}>(getFunctions(), 'cancelBadgeDeletion')(data);

export const callChangeUserGroup = (data: {targetUid: string; newGroup: string; title?: string; titleCn?: string}) =>
    httpsCallable<{targetUid: string; newGroup: string; title?: string; titleCn?: string}, {
        oldGroup: string;
        newGroup: string
    }>(
        getFunctions(), 'changeUserGroup'
    )(data);

// Exactly one of expiresAt (ISO date, or null to revoke) and extendDays per call.
export const callSetMembership = (data: {targetUid: string; expiresAt?: string | null; extendDays?: number}) =>
    httpsCallable<{targetUid: string; expiresAt?: string | null; extendDays?: number}, {
        membershipExpiresAt: string | null;
    }>(
        getFunctions(), 'setMembership'
    )(data);

export const callSetUserTitle = (data: {targetUid: string; title?: string; titleCn?: string}) =>
    httpsCallable<{targetUid: string; title?: string; titleCn?: string}, {success: boolean}>(
        getFunctions(), 'setUserTitle'
    )(data);

export const callSavePastEvent = (data: {
    eventId?: string;
    title: string; titleCn: string; tagIds: string[]; date: string;
    location: string; locationCn: string; venueId: string;
    description: string; descriptionCn: string; icon: string;
    recapLink: string; recapLinkCn: string;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'savePastEvent')(data);

export const callSetPastEventPublished = (data: {eventId: string; published: boolean}) =>
    httpsCallable<typeof data, {published: boolean}>(getFunctions(), 'setPastEventPublished')(data);

export const callSaveUpcomingEvent = (data: {
    eventId?: string;
    title: string; titleCn: string; description: string; descriptionCn: string;
    location: string; locationCn: string; venueId: string; startAt: string; endAt: string;
    poster: string; emailHeaderBg: string; posterCredit: string;
    buyTicket: string; learnMore: string;
    customButtonText: string; customButtonTextCn: string; customButtonLink: string;
    paid: boolean;
}) => httpsCallable<typeof data, {eventId: string}>(getFunctions(), 'saveUpcomingEvent')(data);

export const callRequestUpcomingEventDeletion = (data: {eventId: string}) =>
    httpsCallable<{eventId: string}, {deleteAt: string}>(getFunctions(), 'requestUpcomingEventDeletion')(data);

export const callCancelUpcomingEventDeletion = (data: {eventId: string}) =>
    httpsCallable<{eventId: string}, {cancelled: boolean}>(getFunctions(), 'cancelUpcomingEventDeletion')(data);

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
    /** With updateExisting, on the last chunk: every number in the file, to flag the rest missing. */
    completeTicketIds?: string[];
    /** The same for every chunk of one file, which then leaves one record. */
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
    /** The same for every chunk of one file, which then leaves one record. */
    syncId: string;
}) => httpsCallable<typeof data, {synced: number; unchanged: number; unmatched: number}>(
    getFunctions(), 'syncHometownOrderTimes')(data);

export const callSetHometownAdmitUnlisted = (data: {eventId: string; enabled: boolean}) =>
    httpsCallable<typeof data, {enabled: boolean}>(getFunctions(), 'setHometownAdmitUnlisted')(data);

/**
 * How long a scan waits for the server, well under the SDK's 70 s default: a
 * door can't stand still that long, and a scanner waits on each answer.
 */
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
    poster: string;
    startAt: string;
    tickets: HeldTicket[];
}

export const callGetMyTickets = () =>
    httpsCallable<Record<string, never>, {events: HeldTicketEvent[]}>(getFunctions(), 'getMyTickets')({});

/** `uid` and `displayName` are populated for core-staff+ callers only. */
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
    /** Left out to keep each ticket's own note; given, it's set on every ticket. */
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

export const callGetTicketEmailQuota = () =>
    httpsCallable<Record<string, never>, {
        sentToday: number;
        dailyCap: number;
        chunkSize: number;
        queuedCount: number;
        queueCap: number;
    }>(getFunctions(), 'getTicketEmailQuota')({});

export const callGetEmailQuotaStatus = () =>
    httpsCallable<Record<string, never>, {
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
    }>(getFunctions(), 'getEmailQuotaStatus')({});

export const callUpdateEventEmailTemplate = (data: {
    eventId: string;
    subject: string;
    bodyHtml: string;
}) => httpsCallable<typeof data, {saved: boolean}>(
    getFunctions(), 'updateEventEmailTemplate')(data);

export const callAssignEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {added: boolean; attendeeRemoved: boolean}>(
        getFunctions(), 'assignEventStaff')(data);

export const callRemoveEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {removed: boolean}>(getFunctions(), 'removeEventStaff')(data);

export const callSavePolicy = (data: {contentEn: string; contentCn: string}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'savePolicy')(data);

export const callSaveSiteConfig = (data: {
    contactEmail?: string,
    socialLinks?: SocialLinks,
    senderPrefix?: string,
    conEdition?: ConEdition | null
}) =>
    httpsCallable<typeof data, {saved: boolean, socialLinks?: SocialLinks}>(getFunctions(), 'saveSiteConfig')(data);

export const callSaveConContent = (data: Partial<ConContent>) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveConContent')(data);

export const callSaveTeamMembers = (data: {teamMembers: any[]}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveTeamMembers')(data);

export const callGetPublicTeamMembers = () =>
    httpsCallable<Record<string, never>, {teamMembers: TeamMemberConfig[]}>(getFunctions(), 'getPublicTeamMembers')({});

export const callGetSenderSettings = () =>
    httpsCallable<Record<string, never>, {
        domain: string,
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
}) => httpsCallable<typeof data, {venueId: string}>(getFunctions(), 'saveVenue')(data);

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

export const callGeneratePassports = (data: {designId: string; count: number}) =>
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

export const callSetPassportPrivacy = (data: {hide: boolean}) =>
    httpsCallable<typeof data, {hidePassportPage: boolean}>(getFunctions(), 'setPassportPrivacy')(data);

// Partial: the server merges, so two open tabs can't undo each other's switches.
export const callSetProfileVisibility = (data: {sections: Partial<ProfileVisibility>}) =>
    httpsCallable<typeof data, {visibility: ProfileVisibility}>(getFunctions(), 'setProfileVisibility')(data);

/**
 * `designId` edits that design; without it, `year` is required and a new one is
 * created. The year is fixed after that.
 */
export const callSavePassportDesign = (data: {
    designId?: string;
    year?: number;
    name: string;
    nameCn: string;
    coverImageUrl: string;
    /** Blank to fall back to `coverImageUrl` for the shut passport. */
    outerCoverImageUrl: string;
    termDays: number;
}) => httpsCallable<typeof data, {designId: string}>(getFunctions(), 'savePassportDesign')(data);

export const callDeletePassportDesign = (data: {designId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deletePassportDesign')(data);

/**
 * Mints a passport for each listed address, so two for one listed twice, and
 * emails each its key, up to MAX_PASSPORT_EMAIL a call. Addresses come back
 * sorted by what became of them when they weren't sent or queued.
 */
export const callEmailPassports = (data: {designId: string; emails: string[]}) =>
    httpsCallable<typeof data, {
        sentCount: number;
        queuedCount: number;
        /** Past both the daily cap and the queue: nothing minted. */
        deferred: string[];
        /** Resend refused the email, so the passport was deleted again. */
        failed: string[];
    }>(getFunctions(), 'emailPassports')(data);

export const callUpdatePassportEmailTemplate = (data: {subject: string; bodyHtml: string}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'updatePassportEmailTemplate')(data);

export const callGetPublicProfile = (data: {uid: string}) =>
    httpsCallable<{uid: string}, {
        displayName: string; photoURL: string; bannerURL: string; joinedAt: string;
        attendedEvents: string[]; eventStaffEvents: string[];
        badges: string[];
        badgeEarnedAt: Record<string, string>;
        passports: {id: string; designId: string; year: number; claimedAt: string | null}[];
        /** Their passport page is private, so the shelf's cards don't link to it. */
        passportPageHidden: boolean;
        group: string;
        isMember: boolean;
        title?: string;
        titleCn?: string;
        // Hidden sections arrive empty; these say which, so the page can tell
        // "kept private" from "none yet".
        visibility: {badges: boolean; events: boolean; passports: boolean};
    }>(getFunctions(), 'getPublicProfile')(data);

// Callables carry JSON, so an uploaded file travels as bare base64.
const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

export const callUploadAdminImage = async (file: File, storagePath: string): Promise<string> => {
    const base64 = await readFileAsBase64(file);
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

/** The con hero's background loop. `storagePath` must sit under `con/`. */
export const callUploadConVideo = async (file: File, storagePath: string): Promise<string> => {
    const base64 = await readFileAsBase64(file);
    const result = await httpsCallable<
        {path: string; data: string; contentType: string},
        {url: string}
    >(getFunctions(), 'uploadConVideo')({
        path: storagePath,
        data: base64,
        contentType: file.type,
    });
    return result.data.url;
};

export const callGetUploadLimits = () =>
    httpsCallable<Record<string, never>, UploadLimits>(getFunctions(), 'getUploadLimits')({});

export const callUpdateDisplayName = (data: {displayName: string; targetUid?: string}) =>
    httpsCallable<{displayName: string; targetUid?: string}, {displayName: string}>(
        getFunctions(), 'updateDisplayName'
    )(data);

export const callDeleteAvatar = (data: {targetUid?: string} = {}) =>
    httpsCallable<{targetUid?: string}, {photoURL: string}>(getFunctions(), 'deleteAvatar')(data);

export const callRequestAccountDeletion = (data: {targetUid?: string} = {}) =>
    httpsCallable<{targetUid?: string}, {deleteAt: string}>(
        getFunctions(), 'requestAccountDeletion'
    )(data);

export const callCancelAccountDeletion = (data: {targetUid?: string} = {}) =>
    httpsCallable<{targetUid?: string}, {cancelled: boolean}>(
        getFunctions(), 'cancelAccountDeletion'
    )(data);

export const callUploadAvatar = async (file: File, targetUid?: string): Promise<string> => {
    const base64 = await readFileAsBase64(file);
    const result = await httpsCallable<
        {data: string; contentType: string; targetUid?: string},
        {url: string}
    >(getFunctions(), 'uploadAvatar')({
        data: base64,
        contentType: file.type,
        targetUid,
    });
    return result.data.url;
};

// Your own banner only — unlike the avatar, there is no admin path to set one.
export const callUploadBanner = async (file: File): Promise<string> => {
    const base64 = await readFileAsBase64(file);
    const result = await httpsCallable<
        {data: string; contentType: string},
        {url: string}
    >(getFunctions(), 'uploadBanner')({
        data: base64,
        contentType: file.type,
    });
    return result.data.url;
};

// No targetUid removes your own; an admin passes one to take down someone else's.
export const callDeleteBanner = (data: {targetUid?: string} = {}) =>
    httpsCallable<{targetUid?: string}, {deleted: boolean}>(getFunctions(), 'deleteBanner')(data);

export const functionsErrorCode = (err: unknown): string | null => {
    if (err instanceof FirebaseError && "details" in err) {
        const d = (err as FunctionsError).details as {code?: string} | undefined;
        return d?.code ?? null;
    }
    return null;
};

// The code to show in a message: the server's own when it sent one, else the
// SDK's, such as "functions/internal" for a call that never reached the function
// or "unavailable" for a Firestore read.
const errorCodeToShow = (err: unknown): string | null =>
    functionsErrorCode(err) ?? (err instanceof FirebaseError ? err.code : null);

/** That code as a message's bracketed ending, " (code)" or "（code）", or "" without one. */
export const errorSuffix = (err: unknown, isEnglish: boolean): string => {
    const code = errorCodeToShow(err);
    if (!code) return '';
    return isEnglish ? ` (${code})` : `（${code}）`;
};

export const functionsErrorDetails = <T = unknown>(err: unknown): T | null => {
    if (err instanceof FirebaseError && "details" in err) {
        return ((err as FunctionsError).details as T | undefined) ?? null;
    }
    return null;
};

const googleProvider = new GoogleAuthProvider();
// Always show the account chooser: signOut() doesn't end the browser's Google
// session, so otherwise the popup silently picks the same account again and
// switching accounts is impossible.
googleProvider.setCustomParameters({prompt: 'select_account'});

export const signInWithGoogle = () => signInWithPopup(getFirebaseAuth(), googleProvider);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
