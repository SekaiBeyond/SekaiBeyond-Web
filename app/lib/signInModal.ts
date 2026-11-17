const OPEN_EVENT = 'open-sign-in-modal';

export const openSignInModal = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

export const onOpenSignInModal = (handler: () => void) => {
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
};
