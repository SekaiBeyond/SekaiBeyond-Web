import { createContext, type FC, type ReactNode, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, type DocumentData, getDoc, Timestamp } from 'firebase/firestore';
import {
    callCreateUserProfile,
    callDeleteAvatar,
    callDeleteBanner,
    callUpdateDisplayName,
    callUploadAvatar,
    callUploadBanner,
    getFirebaseAuth,
    getFirebaseDb,
    signInWithGoogle as firebaseSignIn,
    signOut as firebaseSignOut
} from '~/lib/firebase';
import { type ProfileVisibility, readVisibility } from '~/lib/privacy';

// `group` is a pure role ladder. Whether someone has paid is membership, which
// lives in membershipExpiresAt and never moves anyone between these values.
export type UserGroup = 'user' | 'staff' | 'core-staff' | 'president';

export const USER_GROUPS: UserGroup[] = ['user', 'staff', 'core-staff', 'president'];

const GROUP_LEVEL: Record<UserGroup, number> = {
    'user': 0,
    'staff': 1,
    'core-staff': 2,
    'president': 3,
};

export const GROUP_LABELS: Record<UserGroup, {en: string; zh: string}> = {
    'user': {en: 'User', zh: '用户'},
    'staff': {en: 'Staff', zh: '工作人员'},
    'core-staff': {en: 'Core Staff', zh: '核心成员'},
    'president': {en: 'President', zh: '社长'},
};

// Anything that isn't a known group reads as the base group, so GROUP_LEVEL never
// comes back undefined and turns every permission check false.
export function normalizeGroup(raw: unknown): UserGroup {
    return raw === 'staff' || raw === 'core-staff' || raw === 'president' ? raw : 'user';
}

// Membership is active purely by comparison — nothing is written when it starts,
// so nothing has to be undone when it ends.
export function isMembershipActive(expiresAt: Date | null | undefined): boolean {
    return expiresAt instanceof Date && expiresAt.getTime() > Date.now();
}

export function hasPermission(userGroup: UserGroup, requiredGroup: UserGroup): boolean {
    return GROUP_LEVEL[userGroup] >= GROUP_LEVEL[requiredGroup];
}

export function canAssignGroup(assignerGroup: UserGroup, targetGroup: UserGroup): boolean {
    if (assignerGroup === 'president') return true;
    if (assignerGroup === 'core-staff') return GROUP_LEVEL[targetGroup] <= GROUP_LEVEL['staff'];
    return false;
}

export function canManageUser(assignerGroup: UserGroup, userCurrentGroup: UserGroup): boolean {
    if (assignerGroup === 'president') return true;
    if (assignerGroup === 'core-staff') return GROUP_LEVEL[userCurrentGroup] < GROUP_LEVEL['core-staff'];
    return false;
}

export function formatGroupWithTitle(
    group: UserGroup,
    title: string | undefined,
    titleCn: string | undefined,
    isEnglish: boolean,
): string {
    const label = isEnglish ? GROUP_LABELS[group].en : GROUP_LABELS[group].zh;
    // Prefer the viewer's language, falling back to the other so a title set in
    // only one language still renders.
    const resolved = (isEnglish ? title || titleCn : titleCn || title)?.trim();
    return resolved ? `${label} - ${resolved}` : label;
}

// An account's effective title per language: its explicit title, else its group label.
// Presidents (and anyone without a title) fall back to the group name, e.g. "President".
export function accountEffectiveTitle(
    group: UserGroup,
    title: string | undefined,
    titleCn: string | undefined,
): {en: string; zh: string} {
    const labels = GROUP_LABELS[group] ?? {en: '', zh: ''};
    return {
        en: (title || titleCn || labels.en).trim(),
        zh: (titleCn || title || labels.zh).trim(),
    };
}

export interface UserProfile {
    displayName: string;
    email: string;
    photoURL: string;
    /** The member's uploaded profile banner; empty when they have none. */
    bannerURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
    membershipExpiresAt: Date | null;
    /**
     * When the current run of membership began; null for someone who has never
     * had one. Left over from the last run once it lapses.
     */
    membershipStartedAt: Date | null;
    /** Opt-out for the public passport page at /p/:passportId. Default false. */
    hidePassportPage: boolean;
    /** Which sections other people are shown. Anything unset is visible. */
    profileVisibility: ProfileVisibility;
    title?: string;
    titleCn?: string;
    eventStaffEvents: string[];
}

function parseBadgeEarnedAt(raw: unknown): Record<string, Date> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, Date> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v instanceof Timestamp) out[k] = v.toDate();
    }
    return out;
}

function toUserProfile(data: DocumentData, email: string): UserProfile {
    return {
        displayName: data.displayName,
        email,
        photoURL: data.photoURL,
        bannerURL: data.bannerURL ?? '',
        joinedAt: data.joinedAt?.toDate() ?? new Date(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        badgeEarnedAt: parseBadgeEarnedAt(data.badgeEarnedAt),
        group: normalizeGroup(data.group),
        membershipExpiresAt: data.membershipExpiresAt?.toDate() ?? null,
        membershipStartedAt: data.membershipStartedAt?.toDate() ?? null,
        hidePassportPage: data.hidePassportPage === true,
        profileVisibility: readVisibility(data.profileVisibility),
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        eventStaffEvents: data.eventStaffEvents ?? [],
    };
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    // Derived from profile.membershipExpiresAt so membership checks aren't
    // re-implemented per page. Recomputed on render, not on a timer.
    isMember: boolean;
    // True until both the signed-in user and their profile are known.
    loading: boolean;
    // True once the signed-in user is known, without waiting on the profile, so
    // UI that only needs `user` doesn't sit behind the Firestore read.
    authReady: boolean;
    // The profile photo last seen on this device for the signed-in user, to show
    // until the profile loads. Empty when there is none.
    cachedPhotoURL: string;
    authError: Error | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    updateProfile: (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
        bannerFile?: File;
        deleteBanner?: boolean;
    }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PHOTO_CACHE_KEY = 'profilePhoto';

// Stored with the uid so a different account on this device never shows it.
function readCachedPhoto(uid: string): string {
    try {
        const cached = JSON.parse(localStorage.getItem(PHOTO_CACHE_KEY) ?? 'null');
        return cached?.uid === uid && typeof cached.photoURL === 'string' ? cached.photoURL : '';
    } catch {
        return '';
    }
}

function cachePhoto(uid: string, photoURL: string) {
    try {
        localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify({uid, photoURL}));
    } catch {
        // Storage can be full or blocked; the avatar just waits for the profile.
    }
}

function clearCachedPhoto() {
    try {
        localStorage.removeItem(PHOTO_CACHE_KEY);
    } catch {
        // Nothing to clear if storage is blocked.
    }
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: FC<AuthProviderProps> = ({children}) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [authReady, setAuthReady] = useState(false);
    const [cachedPhotoURL, setCachedPhotoURL] = useState('');
    const [authError, setAuthError] = useState<Error | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (firebaseUser) => {
            setUser(firebaseUser);
            setCachedPhotoURL(firebaseUser ? readCachedPhoto(firebaseUser.uid) : '');
            setAuthReady(true);
            setAuthError(null);

            try {
                if (firebaseUser) {
                    const userRef = doc(getFirebaseDb(), 'users', firebaseUser.uid);
                    const userSnap = await getDoc(userRef);

                    let data = userSnap.data();
                    if (!data) {
                        await callCreateUserProfile();
                        const freshSnap = await getDoc(userRef);
                        data = freshSnap.data();
                        if (!data) {
                            throw new Error('Profile creation succeeded but document was not found.');
                        }
                    }
                    const loaded = toUserProfile(data, firebaseUser.email ?? '');
                    setProfile(loaded);
                    cachePhoto(firebaseUser.uid, loaded.photoURL);
                } else {
                    setProfile(null);
                    clearCachedPhoto();
                }
            } catch (error) {
                console.error('AuthProvider: failed to load or create user profile', error);
                setProfile(null);
                setAuthError(error instanceof Error ? error : new Error(String(error)));
            } finally {
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    const signIn = async () => {
        await firebaseSignIn();
    };

    const signOut = async () => {
        await firebaseSignOut();
        setProfile(null);
    };

    const refreshProfile = async () => {
        if (!user) return;
        const userRef = doc(getFirebaseDb(), 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const loaded = toUserProfile(userSnap.data(), user.email ?? '');
            setProfile(loaded);
            cachePhoto(user.uid, loaded.photoURL);
        }
    };

    const updateProfile = async (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
        bannerFile?: File;
        deleteBanner?: boolean;
    }) => {
        if (!user || !profile) return;

        if (updates.displayName !== undefined) {
            const result = await callUpdateDisplayName({displayName: updates.displayName});
            setProfile(prev => prev ? {...prev, displayName: result.data.displayName} : prev);
        }

        if (updates.deletePhoto) {
            const result = await callDeleteAvatar();
            setProfile(prev => prev ? {...prev, photoURL: result.data.photoURL} : prev);
            cachePhoto(user.uid, result.data.photoURL);
        } else if (updates.photoFile) {
            const url = await callUploadAvatar(updates.photoFile);
            setProfile(prev => prev ? {...prev, photoURL: url} : prev);
            cachePhoto(user.uid, url);
        }

        if (updates.deleteBanner) {
            await callDeleteBanner();
            setProfile(prev => prev ? {...prev, bannerURL: ''} : prev);
        } else if (updates.bannerFile) {
            const url = await callUploadBanner(updates.bannerFile);
            setProfile(prev => prev ? {...prev, bannerURL: url} : prev);
        }
    };

    const value: AuthContextType = {
        user,
        profile,
        isMember: isMembershipActive(profile?.membershipExpiresAt),
        loading,
        authReady,
        cachedPhotoURL,
        authError,
        signIn,
        signOut,
        refreshProfile,
        updateProfile,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
