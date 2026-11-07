import { useEffect, useRef } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { USE_EMULATORS } from '~/lib/firebase';
import { emulatedGoogleToken, googleSignInAvailable, renderGoogleButton } from '~/lib/googleSignIn';

/** The widest Google draws its button. */
const MAX_WIDTH = 400;

/**
 * Google's own sign-in button, or nothing if it isn't set up or won't load, as
 * email and password still work. `onToken` gets the ID token of whoever signs in.
 */
export const GoogleButton = ({onToken}: {onToken: (idToken: string) => void}) => {
    const {isEnglish} = useLanguage();
    const containerRef = useRef<HTMLDivElement>(null);
    const handler = useRef(onToken);
    handler.current = onToken;

    useEffect(() => {
        const container = containerRef.current;
        if (!container || USE_EMULATORS || !googleSignInAvailable) return;
        renderGoogleButton(
            container,
            {width: Math.min(container.clientWidth, MAX_WIDTH), locale: isEnglish ? 'en' : 'zh_CN'},
            idToken => handler.current(idToken),
        ).catch(err => console.error('GoogleButton: failed to load', err));
    }, [isEnglish]);

    if (!googleSignInAvailable) return null;

    if (USE_EMULATORS) {
        return (
            <button
                type="button"
                className="admin-btn admin-btn--dashed auth-submit"
                onClick={() => {
                    const email = window.prompt('Emulator: the Google account\'s email');
                    if (email) onToken(emulatedGoogleToken(email.trim().toLowerCase()));
                }}
            >
                Continue with Google (emulator)
            </button>
        );
    }

    return <div ref={containerRef} className="auth-google"/>;
};
