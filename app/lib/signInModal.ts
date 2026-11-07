const OPEN_EVENT = 'open-sign-in-modal';

/** Apart from the modal itself, as AuthProvider opens it and it needs AuthProvider. */
export const openSignInModal = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

export const onOpenSignInModal = (handler: () => void) => {
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
};
