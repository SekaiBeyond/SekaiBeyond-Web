import { useEffect, useState } from 'react';

const STILL_WAITING_AFTER_MS = 5_000;

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

export const stillWaitingText = (isEnglish: boolean) =>
    isEnglish ? 'Still working. This is taking longer than usual.' : '仍在处理中，比平时久一些，请稍候。';
