import { USE_EMULATORS } from '~/lib/firebase';

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

export const googleSignInAvailable = !!CLIENT_ID || USE_EMULATORS;

let loading: Promise<GoogleIdentityServices> | null = null;

function loadGoogle(): Promise<GoogleIdentityServices> {
    loading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
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

let onToken: ((idToken: string) => void) | null = null;
let initialized = false;

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

export function emulatedGoogleToken(email: string): string {
    const name = email.split('@')[0];
    return `emulator:${JSON.stringify({sub: `emulated-${email}`, email, emailVerified: true, name, photoURL: ''})}`;
}
