import { useEffect, useState } from 'react';

/** How long the server gets to answer before a wait says it's still going. */
const STILL_WAITING_AFTER_MS = 5_000;

/**
 * True once `waiting` has been true for a while, which is when a spinner alone
 * starts to look stuck: a slow connection, or a function that was asleep.
 */
export function useStillWaiting(waiting: boolean): boolean {
    const [still, setStill] = useState(false);

    useEffect(() => {
        if (!waiting) return;
        const timer = setTimeout(() => setStill(true), STILL_WAITING_AFTER_MS);
        return () => {
            clearTimeout(timer);
            setStill(false);
        };
    }, [waiting]);

    return waiting && still;
}

/** What to say then. */
export const stillWaitingText = (isEnglish: boolean) =>
    isEnglish ? 'Still working. This is taking longer than usual.' : '仍在处理中，比平时久一些，请稍候。';
