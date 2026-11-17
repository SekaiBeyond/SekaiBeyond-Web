import { useEffect, useMemo, useRef, useState } from 'react';
import { type AttendeeAccount, callGetAttendeeAccounts } from '~/lib/firebase';

const LOOKUP_CHUNK = 500;

export type AccountLink = AttendeeAccount | null;

export function useAccountLinks(eventId: string, emails: string[]): {
    links: Map<string, AccountLink>;
    failed: {error: unknown} | null;
} {
    const cache = useRef(new Map<string, AccountLink>());
    const [links, setLinks] = useState<Map<string, AccountLink>>(() => new Map());
    const [failed, setFailed] = useState<{error: unknown} | null>(null);

    const wanted = useMemo(
        () => Array.from(new Set(
            emails.map(email => email.trim().toLowerCase()).filter(email => email.length > 0),
        )).sort(),
        [emails],
    );
    const wantedKey = wanted.join(',');

    useEffect(() => {
        cache.current = new Map();
        setLinks(new Map());
    }, [eventId]);

    useEffect(() => {
        const missing = wanted.filter(email => !cache.current.has(email));
        if (missing.length === 0) return;

        let stale = false;
        setFailed(null);

        const lookUp = async () => {
            for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
                const chunk = missing.slice(i, i + LOOKUP_CHUNK);
                const result = await callGetAttendeeAccounts({eventId, emails: chunk});
                if (stale) return;
                for (const email of chunk) cache.current.set(email, null);
                for (const account of result.data.accounts) {
                    cache.current.set(account.email, account);
                }
                setLinks(new Map(cache.current));
            }
        };

        lookUp().catch(err => {
            if (!stale) setFailed({error: err});
        });

        return () => {
            stale = true;
        };
    }, [eventId, wantedKey]);

    return {links, failed};
}
