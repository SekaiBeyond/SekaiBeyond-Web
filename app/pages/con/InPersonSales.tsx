import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import { useNowAcross } from '~/pages/con/hooks';
import { useT } from '~/pages/con/i18n';
import { formatClockTime, formatSessionDay, sessionBounds, ticketFeeFor } from '~/pages/con/utils';

/**
 * The in-person ticket table, under the ticket cards. It is another way to buy
 * the same tickets rather than a section of its own, so it has no nav link.
 *
 * Each session drops off once it closes, and the whole block goes with the last
 * one — a page left open switches over at that moment, like the early bird does.
 */
export const InPersonSales = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {inPersonSales, ticketFee, tickets} = useConContent().content;
    const {location, note, sessions} = inPersonSales;

    const timed = sessions.map(session => {
        const {opens, closes} = sessionBounds(session);
        return {session, opens: new Date(opens).getTime(), closes: new Date(closes).getTime(), iso: [opens, closes]};
    });
    const now = useNowAcross(timed.flatMap(entry => entry.iso));

    // An unparseable time reads as closed, so a bad row is hidden rather than
    // shown with "Invalid Date" in it.
    const upcoming = timed.filter(({closes}) => Number.isFinite(closes) && now < closes);
    if (upcoming.length === 0) return null;

    // The regular price is each tier's highest, so if none of those carries a fee
    // online there is nothing to save by coming in person, and the copy says less.
    const skipsFee = tickets.some(tier => ticketFeeFor(tier.price, ticketFee) > 0);

    return (
        <div className="sbc-callout sbc-inperson">
            <div>
                <h3 className="sbc-callout-title">
                    {skipsFee
                        ? t({en: 'Skip the transaction fee', zh: '线下购票，免手续费'})
                        : t({en: 'Buy your ticket in person', zh: '线下购票'})}
                </h3>
                <p className="sbc-callout-body">
                    {skipsFee
                        ? t({
                            en: `Buy at ${location.en} on any of these days and pay just the ticket price — no online transaction fee.`,
                            zh: `在以下时间前往${location.zh}购票，只需支付票价，无需支付线上手续费。`,
                        })
                        : t({
                            en: `Tickets are also on sale at ${location.en} on these days.`,
                            zh: `以下时间也可前往${location.zh}现场购票。`,
                        })}
                </p>
                {t(note) && <p className="sbc-inperson-note">{t(note)}</p>}
            </div>

            <ul className="sbc-inperson-sessions">
                {upcoming.map(({session, opens}, i) => (
                    <li key={i} className="sbc-inperson-session">
                        <time className="sbc-inperson-day" dateTime={session.date}>
                            {formatSessionDay(session.date, currentLanguage)}
                        </time>
                        <span className="sbc-inperson-time">
                            {formatClockTime(session.start, currentLanguage)} – {formatClockTime(session.end, currentLanguage)}
                        </span>
                        {now >= opens && (
                            <span className="sbc-inperson-open">{t({en: 'Open now', zh: '进行中'})}</span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};
