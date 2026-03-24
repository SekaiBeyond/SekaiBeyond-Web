import React, { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
    getFirebaseAuth,
    getFirebaseDb,
    signInWithGoogle as firebaseSignIn,
    signOut as firebaseSignOut
} from '~/lib/firebase';

interface UserProfile {
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    isAdmin: boolean;
    loading: boolean;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
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
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                const adminRef = doc(getFirebaseDb(), 'admins', firebaseUser.uid);
                const adminSnap = await getDoc(adminRef);
                setIsAdmin(adminSnap.exists());

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
                    });
                } else {
                    const newProfile = {
                        displayName: firebaseUser.displayName ?? '',
                        email: firebaseUser.email ?? '',
                        photoURL: firebaseUser.photoURL ?? '',
                        joinedAt: serverTimestamp(),
                        attendedEvents: [],
                    };
                    await setDoc(userRef, newProfile);
                    setProfile({
                        ...newProfile,
                        joinedAt: new Date(),
                    });
                }
            } else {
                setProfile(null);
                setIsAdmin(false);
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

    const value: AuthContextType = {
        user,
        profile,
        isAdmin,
        loading,
        signIn,
        signOut,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
