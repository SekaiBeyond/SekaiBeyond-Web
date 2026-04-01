import React, { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
    getFirebaseAuth,
    getFirebaseDb,
    getFirebaseStorage,
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
    return GROUP_LEVEL[assignerGroup] >= GROUP_LEVEL[targetGroup];
}

export function getAssignableGroups(assignerGroup: UserGroup): UserGroup[] {
    return USER_GROUPS.filter(g => GROUP_LEVEL[assignerGroup] >= GROUP_LEVEL[g]);
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
    updateProfile: (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
        badges?: string[]
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

export const AuthProvider: React.FC<AuthProviderProps> = ({children}) => {
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
                        email: data.email,
                        photoURL: data.photoURL,
                        joinedAt: data.joinedAt?.toDate() ?? new Date(),
                        attendedEvents: data.attendedEvents ?? [],
                        badges: data.badges ?? [],
                        group: data.group ?? 'visitor',
                    });
                } else {
                    const newProfile = {
                        displayName: firebaseUser.displayName ?? '',
                        email: firebaseUser.email ?? '',
                        photoURL: firebaseUser.photoURL ?? '',
                        joinedAt: serverTimestamp(),
                        attendedEvents: [],
                        badges: [],
                        group: 'visitor' as UserGroup,
                    };
                    await setDoc(userRef, newProfile);
                    setProfile({
                        ...newProfile,
                        joinedAt: new Date(),
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

    const updateProfile = async (updates: {
        displayName?: string;
        photoFile?: File;
        deletePhoto?: boolean;
        badges?: string[]
    }) => {
        if (!user || !profile) return;

        const userRef = doc(getFirebaseDb(), 'users', user.uid);
        const docUpdates: Record<string, string | string[]> = {};

        if (updates.displayName !== undefined) {
            docUpdates.displayName = updates.displayName;
        }

        if (updates.deletePhoto) {
            const storageRef = ref(getFirebaseStorage(), `avatars/${user.uid}`);
            try {
                await deleteObject(storageRef);
            } catch { /* may not exist */
            }
            docUpdates.photoURL = user.photoURL ?? '';
        } else if (updates.photoFile) {
            const storageRef = ref(getFirebaseStorage(), `avatars/${user.uid}`);
            await uploadBytes(storageRef, updates.photoFile);
            docUpdates.photoURL = await getDownloadURL(storageRef);
        }

        if (updates.badges !== undefined) {
            docUpdates.badges = updates.badges;
        }

        if (Object.keys(docUpdates).length > 0) {
            await updateDoc(userRef, docUpdates);
            setProfile(prev => prev ? {...prev, ...docUpdates} : prev);
        }
    };

    const value: AuthContextType = {
        user,
        profile,
        loading,
        signIn,
        signOut,
        updateProfile,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
