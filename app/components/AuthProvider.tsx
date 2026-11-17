import { createContext, type FC, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, type DocumentData, getDoc, Timestamp } from 'firebase/firestore';
import {
    callDeleteAvatar,
    callDeleteBanner,
    callEndAllSessions,
    callEndOwnSession,
    callEndSession,
    callUpdateDisplayName,
    callUploadAvatar,
    callUploadBanner,
    getFirebaseAuth,
    getFirebaseDb,
    signInWithToken as firebaseSignInWithToken,
    signOut as firebaseSignOut
} from '~/lib/firebase';
import { toDate } from '~/lib/collectionCache';
import { eitherLanguage } from '~/lib/localized';
import { type ProfileVisibility, readVisibility } from '~/lib/privacy';
import { openSignInModal } from '~/lib/signInModal';
import { currentSessionId, sessionEnded, signInMovedOn, watchOwnSession } from '~/lib/sessions';

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

export function normalizeGroup(raw: unknown): UserGroup {
    return raw === 'staff' || raw === 'core-staff' || raw === 'president' ? raw : 'user';
}

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
    const resolved = eitherLanguage(isEnglish, title, titleCn).trim();
    return resolved ? `${label} - ${resolved}` : label;
}

export function accountEffectiveTitle(
    group: UserGroup,
    title: string | undefined,
    titleCn: string | undefined,
): {en: string; zh: string} {
    const labels = GROUP_LABELS[group];
    return {
        en: (title || titleCn || labels.en).trim(),
        zh: (titleCn || title || labels.zh).trim(),
    };
}

export interface UserProfile {
    displayName: string;
    email: string;
    photoURL: string;
    bannerURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
    membershipExpiresAt: Date | null;
    membershipStartedAt: Date | null;
    hidePassportPage: boolean;
    profileVisibility: ProfileVisibility;
    title?: string;
    titleCn?: string;
    eventStaffEvents: string[];
    deleteAt: Date | null;
    deletionRequestedBy: string;
}

function parseBadgeEarnedAt(raw: unknown): Record<string, Date> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, Date> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v instanceof Timestamp) out[k] = v.toDate();
    }
    return out;
}

function toUserProfile(data: DocumentData): UserProfile {
    return {
        displayName: data.displayName,
        email: data.email ?? '',
        photoURL: data.photoURL,
        bannerURL: data.bannerURL ?? '',
        joinedAt: toDate(data.joinedAt) ?? new Date(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        badgeEarnedAt: parseBadgeEarnedAt(data.badgeEarnedAt),
        group: normalizeGroup(data.group),
        membershipExpiresAt: toDate(data.membershipExpiresAt),
        membershipStartedAt: toDate(data.membershipStartedAt),
        hidePassportPage: data.hidePassportPage === true,
        profileVisibility: readVisibility(data.profileVisibility),
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        eventStaffEvents: data.eventStaffEvents ?? [],
        deleteAt: toDate(data.deleteAt),
        deletionRequestedBy: typeof data.deletionRequestedBy === 'string' ? data.deletionRequestedBy : '',
    };
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    isMember: boolean;
    loading: boolean;
    authReady: boolean;
    cachedPhotoURL: string;
    sessionId: string | null;
    signIn: () => void;
    signInWithToken: (token: string) => Promise<void>;
    signOut: () => Promise<void>;
    signOutEverywhere: () => Promise<void>;
    replaceSession: (token: string) => Promise<void>;
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
    }
}

function clearCachedPhoto() {
    try {
        localStorage.removeItem(PHOTO_CACHE_KEY);
    } catch {
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
    const [sessionId, setSessionId] = useState<string | null>(null);
    const stopWatchingSession = useRef<(() => void) | null>(null);
    const profileLoad = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        const loadProfile = async (firebaseUser: User | null) => {
            setUser(firebaseUser);
            setCachedPhotoURL(firebaseUser ? readCachedPhoto(firebaseUser.uid) : '');
            setAuthReady(true);

            try {
                if (firebaseUser) {
                    const userRef = doc(getFirebaseDb(), 'users', firebaseUser.uid);
                    const userSnap = await getDoc(userRef);

                    const data = userSnap.data();
                    if (!data) {
                        await firebaseSignOut();
                        return;
                    }
                    const loaded = toUserProfile(data);
                    setProfile(loaded);
                    cachePhoto(firebaseUser.uid, loaded.photoURL);
                } else {
                    setProfile(null);
                    clearCachedPhoto();
                }
            } catch (error) {
                if (firebaseUser && error instanceof FirebaseError && error.code === 'permission-denied'
                    && await sessionEnded()) {
                    await firebaseSignOut();
                    return;
                }
                console.error('AuthProvider: failed to load or create user profile', error);
                setProfile(null);
            } finally {
                setLoading(false);
            }
        };
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), firebaseUser => {
            profileLoad.current = loadProfile(firebaseUser);
        });

        return () => unsubscribe();
    }, []);

    const [sessionGeneration, setSessionGeneration] = useState(0);

    const hasProfile = !!profile;
    useEffect(() => {
        if (!user || !hasProfile) {
            setSessionId(null);
            return;
        }
        let stale = false;
        const onEnded = async (endedId: string) => {
            if (await signInMovedOn(endedId)) {
                if (!stale) setSessionGeneration(generation => generation + 1);
                return;
            }
            await firebaseSignOut();
        };
        const live = getFirebaseAuth().currentUser;
        void currentSessionId(live?.uid === user.uid ? live : user).then(id => {
            if (stale || !id) return;
            setSessionId(id);
            stopWatchingSession.current = watchOwnSession(user.uid, id, () => void onEnded(id));
        });
        return () => {
            stale = true;
            stopWatchingSession.current?.();
            stopWatchingSession.current = null;
        };
    }, [user, hasProfile, sessionGeneration]);

    const signIn = () => openSignInModal();

    const signInWithToken = async (token: string) => {
        await firebaseSignInWithToken(token);
        await profileLoad.current.catch(() => {
        });
        if (!getFirebaseAuth().currentUser) throw new Error('The sign-in didn’t hold.');
    };

    const signOut = async () => {
        stopWatchingSession.current?.();
        await callEndOwnSession().catch(() => {
        });
        await firebaseSignOut();
        setProfile(null);
    };

    const signOutEverywhere = async () => {
        await callEndAllSessions();
        stopWatchingSession.current?.();
        await firebaseSignOut();
        setProfile(null);
    };

    const replaceSession = async (token: string) => {
        const oldSessionId = sessionId;
        stopWatchingSession.current?.();
        stopWatchingSession.current = null;
        const credential = await firebaseSignInWithToken(token);
        setUser(credential.user);
        if (oldSessionId) {
            await callEndSession({sessionId: oldSessionId}).catch(() => {
            });
        }
    };

    const refreshProfile = async () => {
        if (!user) return;
        const userRef = doc(getFirebaseDb(), 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const loaded = toUserProfile(userSnap.data());
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
        sessionId,
        signIn,
        signInWithToken,
        signOut,
        signOutEverywhere,
        replaceSession,
        refreshProfile,
        updateProfile,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
