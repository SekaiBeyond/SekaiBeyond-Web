import type { LotStatus, Rate } from '~/lib/parkingStatus';
import { walkMinutes } from '~/lib/uwParking';
import { siteDay } from '~/lib/siteTime';
import { formatDistanceEstimate, PARKING_INFO_URL } from '~/lib/venues';
import type { LotView } from './model';
import type { ParkingText } from './text';

export const StatusPill = ({status, tx}: {status: LotStatus; tx: ParkingText}) => (
    <span className={`parking-status parking-s-${status.kind}`}>{tx.status(status)}</span>
);

/**
 * "💲 $5/hr · $21/day", or "💲 During your event: $5/hr · $21/day" on an event's guide: what a
 * visitor pays then; nothing when they don't pay, or can't park.
 */
export const RatesLine = ({rates, isNow, tx}: {rates: Rate[]; isNow: boolean; tx: ParkingText}) =>
    rates.length > 0 ? (
        <span className="parking-rate-line">
            💲 {isNow ? tx.rates(rates) : tx.t('ratesEvent', {r: tx.rates(rates)})}
        </span>
    ) : null;

/**
 * How far a lot is: "2 min walk to HUB" (`venueName` given), "2 min walk", or
 * "2 min" (`short`). Without a measured walk, a straight-line estimate instead.
 */
export function walkText(view: LotView, tx: ParkingText, options: {venueName?: string; short?: boolean} = {}): string {
    if (view.walk) {
        const n = walkMinutes(view.walk.seconds);
        if (options.short) return tx.t('walkMin', {n});
        return options.venueName ? tx.t('walkTo', {n, v: options.venueName}) : tx.t('walkShort', {n});
    }
    return view.miles === null ? '' : formatDistanceEstimate(view.miles, tx.isEnglish);
}

/** Where the lot data comes from and when it was updated, at the bottom of the page; nothing without a date. */
export const Footer = ({generatedAt, tx}: {generatedAt: string; tx: ParkingText}) => {
    const generated = new Date(generatedAt);
    if (Number.isNaN(generated.getTime())) return null;
    const [before, after] = tx.t('credit', {d: tx.date(siteDay(generated))}).split('{uw}');
    return (
        <footer className="parking-footer">
            <small>
                {before}
                <a href={PARKING_INFO_URL} target="_blank" rel="noopener noreferrer">
                    {tx.t('uw')}
                </a>
                {after}
            </small>
        </footer>
    );
};
