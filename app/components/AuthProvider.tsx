import { createContext, type FC, type ReactNode, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import {
    callCreateUserProfile,
    callDeleteAvatar,
    callUpdateDisplayName,
    callUploadAvatar,
    getFirebaseAuth,
    getFirebaseDb,
    signInWithGoogle as firebaseSignIn,
    signOut as firebaseSignOut
} from '~/lib/firebase';

export type UserGroup = 'visitor' | 'member' | 'staff' | 'core-staff' | 'president';

export const USER_GROUPS: UserGroup[] = ['visitor', 'member', 'staff', 'core-staff', 'president'];

const GROUP_LEVEL: Record<UserGroup, number> = {
    'visitor': 0,
    'member': 1,
    'staff': 2,
    'core-staff': 3,
    'president': 4,
};

export const GROUP_LABELS: Record<UserGroup, {en: string; zh: string}> = {
    'visitor': {en: 'Visitor', zh: '访客'},
    'member': {en: 'Member', zh: '成员'},
    'staff': {en: 'Staff', zh: '工作人员'},
    'core-staff': {en: 'Core Staff', zh: '核心成员'},
    'president': {en: 'President', zh: '社长'},
};

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

export function formatGroupWithTitle(group: UserGroup, title: string | undefined, isEnglish: boolean): string {
    const label = isEnglish ? GROUP_LABELS[group].en : GROUP_LABELS[group].zh;
    return title ? `${label} - ${title}` : label;
}

export interface UserProfile {
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
    title?: string;
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

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    authError: Error | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    updateProfile: (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
    }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    const [authError, setAuthError] = useState<Error | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (firebaseUser) => {
            setUser(firebaseUser);
            setAuthError(null);

            try {
                if (firebaseUser) {
                    const userRef = doc(getFirebaseDb(), 'users', firebaseUser.uid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        const data = userSnap.data();
                        setProfile({
                            displayName: data.displayName,
                            email: firebaseUser.email ?? '',
                            photoURL: data.photoURL,
                            joinedAt: data.joinedAt?.toDate() ?? new Date(),
                            attendedEvents: data.attendedEvents ?? [],
                            badges: data.badges ?? [],
                            badgeEarnedAt: parseBadgeEarnedAt(data.badgeEarnedAt),
                            group: data.group ?? 'visitor',
                            title: data.title ?? '',
                            eventStaffEvents: data.eventStaffEvents ?? [],
                        });
                    } else {
                        await callCreateUserProfile();
                        const freshSnap = await getDoc(userRef);
                        const data = freshSnap.data();
                        if (!data) {
                            throw new Error('Profile creation succeeded but document was not found.');
                        }
                        setProfile({
                            displayName: data.displayName,
                            email: firebaseUser.email ?? '',
                            photoURL: data.photoURL,
                            joinedAt: data.joinedAt?.toDate() ?? new Date(),
                            attendedEvents: [],
                            badges: [],
                            badgeEarnedAt: {},
                            group: 'visitor',
                            title: '',
                            eventStaffEvents: [],
                        });
                    }
                } else {
                    setProfile(null);
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
            const data = userSnap.data();
            setProfile({
                displayName: data.displayName,
                email: user.email ?? '',
                photoURL: data.photoURL,
                joinedAt: data.joinedAt?.toDate() ?? new Date(),
                attendedEvents: data.attendedEvents ?? [],
                badges: data.badges ?? [],
                badgeEarnedAt: parseBadgeEarnedAt(data.badgeEarnedAt),
                group: data.group ?? 'visitor',
                title: data.title ?? '',
                eventStaffEvents: data.eventStaffEvents ?? [],
            });
        }
    };

    const updateProfile = async (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
    }) => {
        if (!user || !profile) return;

        if (updates.displayName !== undefined) {
            const result = await callUpdateDisplayName({displayName: updates.displayName});
            setProfile(prev => prev ? {...prev, displayName: result.data.displayName} : prev);
        }

        if (updates.deletePhoto) {
            const result = await callDeleteAvatar();
            setProfile(prev => prev ? {...prev, photoURL: result.data.photoURL} : prev);
        } else if (updates.photoFile) {
            const url = await callUploadAvatar(updates.photoFile);
            setProfile(prev => prev ? {...prev, photoURL: url} : prev);
        }
    };

    const value: AuthContextType = {
        user,
        profile,
        loading,
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
