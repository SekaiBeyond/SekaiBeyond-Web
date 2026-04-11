import { createContext, type FC, type ReactNode, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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

export function getAssignableGroups(assignerGroup: UserGroup): UserGroup[] {
    return USER_GROUPS.filter(g => canAssignGroup(assignerGroup, g));
}

export interface UserProfile {
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
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

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (firebaseUser) => {
            setUser(firebaseUser);

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
                        group: data.group ?? 'visitor',
                    });
                } else {
                    await callCreateUserProfile();
                    const freshSnap = await getDoc(userRef);
                    const data = freshSnap.data()!;
                    setProfile({
                        displayName: data.displayName,
                        email: firebaseUser.email ?? '',
                        photoURL: data.photoURL,
                        joinedAt: data.joinedAt?.toDate() ?? new Date(),
                        attendedEvents: [],
                        badges: [],
                        group: 'visitor',
                    });
                }
            } else {
                setProfile(null);
            }

            setLoading(false);
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
                group: data.group ?? 'visitor',
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
