import { useEffect, useMemo, useRef, useState } from 'react';
import { type AttendeeAccount, callGetAttendeeAccounts } from '~/lib/firebase';

/** What one lookup may ask about — mirrors ACCOUNT_LOOKUP_MAX on the server. */
const LOOKUP_CHUNK = 500;

/** An email that has been checked: the account behind it, or null for none. */
export type AccountLink = AttendeeAccount | null;

/**
 * Whether each of these ticket emails belongs to a registered account — the
 * thing that decides, when the ticket is scanned, whether anybody's profile
 * hears about it.
 *
 * Answers are cached for the life of the surface, so a list that grows as more
 * attendees are shown only ever asks about the addresses it hasn't seen. That
 * matters more than it looks: every callable shares one rate-limit budget, so a
 * lookup per render would cost an admin the ability to do anything else.
 *
 * An email absent from `links` has not been checked yet; one mapped to null has
 * been checked and has no account. Callers need that difference to tell "no
 * account" from "still looking".
 *
 * Pass a stable `emails` array — memoise it at the call site, or derive it from
 * state that only changes when the addresses do.
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

    // An event of its own gets its own answers: eventId is what authorises the
    // lookup, so a cache carried across events would be answering for a caller
    // who may not be staff on this one.
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
                // Everything asked about is now known: the matches name an
                // account, and whatever didn't come back has none.
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
