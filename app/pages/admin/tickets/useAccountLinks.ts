import { useEffect, useMemo, useRef, useState } from 'react';
import { type AttendeeAccount, callGetAttendeeAccounts } from '~/lib/firebase';

/** What one lookup may ask about — mirrors ACCOUNT_LOOKUP_MAX on the server. */
const LOOKUP_CHUNK = 500;

/** An email that has been checked: the account behind it, or null for none. */
export type AccountLink = AttendeeAccount | null;

/**
 * Whether each ticket email belongs to a registered account, which decides
 * whether a scan reaches a profile.
 *
 * Answers are cached for the surface's life, so a growing list only asks about
 * new addresses: every callable shares one rate-limit budget. An email absent
 * from `links` is unchecked; null means no account.
 *
 * Pass a stable `emails` array.
 */
export function useAccountLinks(eventId: string, emails: string[]): {
    links: Map<string, AccountLink>;
    loading: boolean;
    failed: boolean;
} {
    const cache = useRef(new Map<string, AccountLink>());
    const [links, setLinks] = useState<Map<string, AccountLink>>(() => new Map());
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const wanted = useMemo(
        () => Array.from(new Set(
            emails.map(email => email.trim().toLowerCase()).filter(email => email.length > 0),
        )).sort(),
        [emails],
    );
    const wantedKey = wanted.join(',');

    // A new event starts fresh: eventId authorises the lookup, and the caller
    // may not be staff on this one.
    useEffect(() => {
        cache.current = new Map();
        setLinks(new Map());
    }, [eventId]);

    useEffect(() => {
        const missing = wanted.filter(email => !cache.current.has(email));
        if (missing.length === 0) return;

        let stale = false;
        setLoading(true);
        setFailed(false);

        const lookUp = async () => {
            for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
                const chunk = missing.slice(i, i + LOOKUP_CHUNK);
                const result = await callGetAttendeeAccounts({eventId, emails: chunk});
                if (stale) return;
                // Whatever didn't come back has no account.
                for (const email of chunk) cache.current.set(email, null);
                for (const account of result.data.accounts) {
                    cache.current.set(account.email, account);
                }
                setLinks(new Map(cache.current));
            }
        };

        lookUp()
            .catch(() => {
                if (!stale) setFailed(true);
            })
            .finally(() => {
                if (!stale) setLoading(false);
            });

        return () => {
            stale = true;
        };
        // wantedKey stands in for `wanted`, whose identity changes every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, wantedKey]);

    return {links, loading, failed};
}
