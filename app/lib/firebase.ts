import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type FirebaseStorage, getStorage } from "firebase/storage";

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
let storage: FirebaseStorage;

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

export function getFirebaseStorage() {
    if (!storage) {
        storage = getStorage(getFirebaseApp());
    }
    return storage;
}

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(getFirebaseAuth(), googleProvider);

export const signOut = () => firebaseSignOut(getFirebaseAuth());
