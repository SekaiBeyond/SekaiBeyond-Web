import { USE_EMULATORS } from '~/lib/firebase';

/**
 * Sign in with Google, through Google's own button. It hands back an ID token
 * saying who signed in, which means nothing until the functions have checked it
 * (signInWithGoogle). Loaded only when the sign-in modal needs it.
 */

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface GoogleIdentityServices {
    accounts: {
        id: {
            initialize: (config: {client_id: string; callback: (response: {credential: string}) => void}) => void;
            renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
        };
    };
}

declare global {
    interface Window {
        google?: GoogleIdentityServices;
    }
}

/** False when the site was built without a client ID, so there's no button to show. */
export const googleSignInAvailable = !!CLIENT_ID || USE_EMULATORS;

let loading: Promise<GoogleIdentityServices> | null = null;

function loadGoogle(): Promise<GoogleIdentityServices> {
    loading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
        // Failing to load, or loading without defining anything, as when a
        // content blocker stands in for it, is forgotten, so opening the modal
        // again tries again.
        const fail = () => {
            loading = null;
            script.remove();
            reject(new Error('Google sign-in didn’t load.'));
        };
        script.onload = () => window.google ? resolve(window.google) : fail();
        script.onerror = fail;
        document.head.appendChild(script);
    });
    return loading;
}

// initialize takes one callback for the page, and warns if it's called twice,
// so it stays put and calls whichever button is showing.
let onToken: ((idToken: string) => void) | null = null;
let initialized = false;

/** Draws Google's button in `parent`, calling `handler` with the ID token of whoever signs in with it. */
export async function renderGoogleButton(
    parent: HTMLElement,
    options: {width: number; locale: string},
    handler: (idToken: string) => void,
): Promise<void> {
    const google = await loadGoogle();
    if (!parent.isConnected) return;
    if (!initialized) {
        google.accounts.id.initialize({
            client_id: CLIENT_ID!,
            callback: response => onToken?.(response.credential),
        });
        initialized = true;
    }
    onToken = handler;
    google.accounts.id.renderButton(parent, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        ...options,
    });
}

/** Google's button can't reach the emulators, so a stand-in names the account. The functions accept it only there. */
export function emulatedGoogleToken(email: string): string {
    const name = email.split('@')[0];
    return `emulator:${JSON.stringify({sub: `emulated-${email}`, email, emailVerified: true, name, photoURL: ''})}`;
}
