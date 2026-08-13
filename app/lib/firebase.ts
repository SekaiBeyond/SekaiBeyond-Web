import { type FirebaseApp, FirebaseError, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { type Auth, getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type Functions, type FunctionsError, getFunctions as _getFunctions, httpsCallable } from "firebase/functions";
import { type ConEdition } from "~/constants";
import type { TeamMemberConfig } from "./siteConfig";
import type { ConContent } from "./conContent";

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

        if (typeof window !== "undefined") {
            const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

            // Enable debug token if VITE_APP_CHECK_DEBUG_TOKEN is provided.
            // Set it to 'true' in .env to generate a token in the console, 
            // or paste a specific debug token.
            if (import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN) {
                (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
                    import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN === 'true'
                        ? true
                        : import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN;
            }

            if (siteKey) {
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
    }
    return auth;
}

export function getFirebaseDb() {
    if (!db) {
        db = getFirestore(getFirebaseApp());
    }
    return db;
}

function getFunctions() {
    if (!functions) {
        functions = _getFunctions(getFirebaseApp());
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
    attendees: Array<{email: string; name: string; ticketCount: number; type: string}>;
    onDuplicate?: 'skip' | 'override';
}) => httpsCallable<typeof data, {added: number; replaced: number; skipped: number; total: number}>(
    getFunctions(), 'importEventAttendees')(data);

export const callRedeemTicket = (data: {eventId: string; ticketId: string}) =>
    httpsCallable<typeof data, {
        success?: boolean;
        alreadyRedeemed?: boolean;
        attendeeName: string;
        attendeeEmail: string;
        eventTitle: string;
        ticketIndex: number;
        ticketType: string;
        userCheckedIn?: boolean;
        // Display name of the staff member who first redeemed the ticket
        // (server returns redeemedByName, not a raw UID). Only set when
        // alreadyRedeemed is true.
        redeemedBy?: string;
        redeemedAt?: string | null;
    }>(getFunctions(), 'redeemTicket')(data);

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
    httpsCallable<typeof data, {deleted: boolean; ticketCount: number}>(
        getFunctions(), 'deleteEventAttendee')(data);

export const callUpdateEventAttendee = (data: {
    eventId: string;
    attendeeId: string;
    name: string;
    ticketCount: number;
    type: string;
}) => httpsCallable<typeof data, {updated: boolean; regenerated: boolean}>(
    getFunctions(), 'updateEventAttendee')(data);

export const callUpdateTicketType = (data: {
    eventId: string;
    attendeeId: string;
    ticketId: string;
    type: string;
}) => httpsCallable<typeof data, {updated: boolean}>(
    getFunctions(), 'updateTicketType')(data);

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

// Panel-wide outbound-email capacity, for the admin Email Quota tool. Broader
// than callGetTicketEmailQuota (which is scoped to one event's send flow): it
// takes a live reading from the email provider, so `providerReported` matches
// the provider's own dashboard, while `sentToday` is the local counter that
// gates sends (provider count + in-flight reservations). Core-staff+.
export const callGetEmailQuotaStatus = () =>
    httpsCallable<Record<string, never>, {
        provider: {
            id: string;
            name: string;
            windowKind: 'rolling24h' | 'calendarDay';
            fromAddress: string;
        };
        // null when the provider's usage could not be read at all — must not
        // be rendered as zero.
        providerReported: number | null;
        readingSource: 'live' | 'cached' | 'unavailable';
        // The server stopped counting at its page budget, so providerReported
        // is a lower bound rather than an exact figure.
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
    bodyCnHtml: string;
}) => httpsCallable<typeof data, {saved: boolean}>(
    getFunctions(), 'updateEventEmailTemplate')(data);

export const callAssignEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {added: boolean; attendeeRemoved: boolean}>(
        getFunctions(), 'assignEventStaff')(data);

export const callRemoveEventStaff = (data: {targetUid: string; eventId: string}) =>
    httpsCallable<typeof data, {removed: boolean}>(getFunctions(), 'removeEventStaff')(data);

export const callSavePolicy = (data: {contentEn: string; contentCn: string}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'savePolicy')(data);

export const callSaveSiteConfig = (data: {bilibiliVideoBvid?: string, conEdition?: ConEdition | null}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveSiteConfig')(data);

// Only the sections present in `data` are written, so each Save button in the
// Con Content tab leaves the sections it does not own untouched.
export const callSaveConContent = (data: Partial<ConContent>) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveConContent')(data);

export const callSaveTeamMembers = (data: {teamMembers: any[]}) =>
    httpsCallable<typeof data, {saved: boolean}>(getFunctions(), 'saveTeamMembers')(data);

// Public resolver: returns team members with account-linked fields (name/role/photo)
// filled from the linked account's live data. Callable without auth.
export const callGetPublicTeamMembers = () =>
    httpsCallable<Record<string, never>, {teamMembers: TeamMemberConfig[]}>(getFunctions(), 'getPublicTeamMembers')({});

// Admin editor read: the full roster (incl. linked-account uid + follow flags) from
// the server-only teamRoster doc. Staff+ only. Public config carries a display-only
// projection, so the editor can't source uid/flags from there.
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

export const callGenerateStaffCode = (data: {
    eventId: string;
    activeFrom?: string;
    activeUntil?: string;
    maxUses?: number;
}) =>
    httpsCallable<typeof data, {id: string; code: string}>(
        getFunctions(), 'generateStaffCode'
    )(data);

export const callClaimStaffCode = (data: {code: string}) =>
    httpsCallable<{code: string}, {
        eventId: string;
        eventTitle: string;
        eventTitleCn: string;
        eventPoster: string;
    }>(getFunctions(), 'claimStaffCode')(data);

export const callToggleStaffCodeActive = (data: {codeId: string; active: boolean}) =>
    httpsCallable<typeof data, {active: boolean}>(getFunctions(), 'toggleStaffCodeActive')(data);

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
    parkingLots: Array<{lotId: string}>;
}) => httpsCallable<typeof data, {venueId: string}>(getFunctions(), 'saveVenue')(data);

export const callDeleteVenue = (data: {venueId: string}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deleteVenue')(data);

export const callSaveParkingLot = (data: {
    lotId?: string;
    name: string;
    nameCn: string;
    type: 'general' | 'disabled' | 'garage';
    lat: number;
    lng: number;
    rateId: string;
}) => httpsCallable<typeof data, {lotId: string}>(getFunctions(), 'saveParkingLot')(data);

export const callDeleteParkingLot = (data: {lotId: string}) =>
    httpsCallable<typeof data, {deleted: boolean; unlinkedFrom: number}>(getFunctions(), 'deleteParkingLot')(data);

export const callSaveParkingRate = (data: {rateId?: string; labelEn: string; labelCn: string; color: string}) =>
    httpsCallable<typeof data, {rateId: string}>(getFunctions(), 'saveParkingRate')(data);

export const callDeleteParkingRate = (data: {rateId: string}) =>
    httpsCallable<typeof data, {deleted: boolean; unlinkedFrom: number}>(getFunctions(), 'deleteParkingRate')(data);

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

// Physical passports. The plaintext activation keys come back from
// callGeneratePassportBatch exactly once and are never re-servable — export the
// CSV/ZIP before leaving the screen or the batch has to be re-keyed one passport
// at a time with callReissuePassportKey.
export const callGeneratePassportBatch = (data: {year: number; count: number}) =>
    httpsCallable<typeof data, {
        batchId: string;
        year: number;
        passports: Array<{passportId: string; activationCode: string}>;
    }>(getFunctions(), 'generatePassportBatch')(data);

export const callReissuePassportKey = (data: {passportId: string}) =>
    httpsCallable<typeof data, {passportId: string; activationCode: string}>(
        getFunctions(), 'reissuePassportKey')(data);

export const callClaimPassport = (data: {passportId: string; activationCode: string}) =>
    httpsCallable<typeof data, {
        membershipExpiresAt: string;
        daysGranted: number;
        year: number;
    }>(getFunctions(), 'claimPassport')(data);

export interface PassportPublicBadge {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    earnedAt: string | null;
}

// One scanned sticker, resolved for anyone — the only unauthenticated read of a
// member's public data. It is keyed by the printed passport code, never by uid,
// and no uid comes back: `isOwner` is decided server-side.
export type PassportPublicProfile =
    | {status: 'invalid'}
    | {status: 'private'}
    | {status: 'unclaimed'; year: number}
    | {
    status: 'claimed';
    year: number;
    claimedAt: string | null;
    isOwner: boolean;
    hidden: boolean;
    /** Owner-only extras; null for every other visitor. */
    scanCount: number | null;
    membershipExpiresAt: string | null;
    owner: {
        displayName: string;
        photoURL: string;
        joinedAt: string | null;
        group: string;
        isMember: boolean;
        title: string;
        titleCn: string;
        // Inlined because the badges collection needs auth to read, which a
        // signed-out scanner does not have.
        badges: PassportPublicBadge[];
        attendedEvents: string[];
        eventStaffEvents: string[];
    };
    /** The owner's collection, by year — no sibling passport ids. */
    shelf: Array<{year: number; claimedAt: string | null}>;
};

export const callGetPassportPublicProfile = (data: {passportId: string}) =>
    httpsCallable<typeof data, PassportPublicProfile>(getFunctions(), 'getPassportPublicProfile')(data);

export const callVoidPassport = (data: {passportId: string}) =>
    httpsCallable<typeof data, {passportId: string; status: 'void'}>(getFunctions(), 'voidPassport')(data);

export const callSetPassportPrivacy = (data: {hide: boolean}) =>
    httpsCallable<typeof data, {hidePassportPage: boolean}>(getFunctions(), 'setPassportPrivacy')(data);

export const callSavePassportDesign = (data: {
    year: number;
    coverImageUrl: string;
}) => httpsCallable<typeof data, {year: number}>(getFunctions(), 'savePassportDesign')(data);

export const callDeletePassportDesign = (data: {year: number}) =>
    httpsCallable<typeof data, {deleted: boolean}>(getFunctions(), 'deletePassportDesign')(data);

export const callGetPublicProfile = (data: {uid: string}) =>
    httpsCallable<{uid: string}, {
        displayName: string; photoURL: string; joinedAt: string;
        attendedEvents: string[]; eventStaffEvents: string[];
        badges: string[];
        badgeEarnedAt: Record<string, string>;
        group: string;
        isMember: boolean;
        title?: string;
        titleCn?: string;
    }>(getFunctions(), 'getPublicProfile')(data);

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
        {data: string; contentType: string; targetUid?: string},
        {url: string}
    >(getFunctions(), 'uploadAvatar')({
        data: base64,
        contentType: file.type,
        targetUid,
    });
    return result.data.url;
};

export const functionsErrorCode = (err: unknown): string | null => {
    if (err instanceof FirebaseError && "details" in err) {
        const d = (err as FunctionsError).details as {code?: string} | undefined;
        return d?.code ?? null;
    }
    return null;
};

export const functionsErrorDetails = <T = unknown>(err: unknown): T | null => {
    if (err instanceof FirebaseError && "details" in err) {
        return ((err as FunctionsError).details as T | undefined) ?? null;
    }
    return null;
};

const googleProvider = new GoogleAuthProvider();
// Always show the Google account chooser. Firebase signOut() only clears the
// app's session, not the browser's Google SSO session, so without this the
// OAuth flow silently re-authenticates the existing account (most visible in
// Chrome, where users are signed into Google at the browser level and the
// FedCM popup auto-selects the returning account) — preventing account switching.
googleProvider.setCustomParameters({prompt: 'select_account'});

export const signInWithGoogle = () => signInWithPopup(getFirebaseAuth(), googleProvider);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
