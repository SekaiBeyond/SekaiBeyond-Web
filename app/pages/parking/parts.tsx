import type { LotStatus } from '~/lib/parkingStatus';
import { type UwLot, uwLotGlyph, walkMinutes } from '~/lib/uwParking';
import { siteDay } from '~/lib/siteTime';
import { formatDistanceEstimate, PARKING_INFO_URL } from '~/lib/venues';
import type { LotView } from './model';
import type { ParkingText } from './text';

export const StatusPill = ({status, tx}: {status: LotStatus; tx: ParkingText}) => (
    <span className={`parking-status parking-s-${status.kind}`}>{tx.status(status)}</span>
);

/** "$5/hr · $21/day · $7 night", or '' when UW lists no visitor rate. */
export function rateText(lot: UwLot, tx: ParkingText): string {
    const {hourly, daily, night} = lot.rates;
    const parts: string[] = [];
    if (hourly) parts.push(tx.money(hourly) + (tx.isEnglish ? '/hr' : '/小时'));
    if (daily) parts.push(tx.money(daily) + (tx.isEnglish ? '/day' : '/天'));
    if (night) parts.push(tx.money(night) + (tx.isEnglish ? ' night' : ' 夜间'));
    return parts.join(' · ');
}

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

/** What a lot's pin shows: its rank among the suggestions, else P or G. */
export const pinGlyph = (view: LotView) => view.rank ? String(view.rank) : uwLotGlyph(view.lot.type);

export const Footer = ({generatedAt, tx}: {generatedAt: string; tx: ParkingText}) => {
    const generated = new Date(generatedAt);
    const updated = Number.isNaN(generated.getTime()) ? '' : tx.date(siteDay(generated));
    const [before, after] = tx.t('credit', {d: updated}).split('{uw}');
    return (
        <div className="parking-panel-footer">
            {updated && (
                <small>
                    {before}
                    <a href={PARKING_INFO_URL} target="_blank" rel="noopener noreferrer">
                        {tx.t('uw')}
                    </a>
                    {after}
                </small>
            )}
            <span className="parking-footer-text">
                <span className="parking-footer-sparkle">✦</span>
                Sekai Beyond 2026
                <span className="parking-footer-sparkle">✦</span>
            </span>
        </div>
    );
};
