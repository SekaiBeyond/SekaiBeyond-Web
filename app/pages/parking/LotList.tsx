import type { PointerEvent } from 'react';
import { clockMinutes, type ParkingWindow } from '~/lib/parkingStatus';
import { type UwEventPricing, uwLotGlyph } from '~/lib/uwParking';
import type { Venue } from '~/lib/venues';
import { type GuideEvent, LOT_FILTERS, type LotFilter, lotSubtitle, type LotView } from './model';
import { NowLine, RatesLine, StatusPill, walkText } from './parts';
import type { ParkingText } from './text';

const UW_EVENT_CALENDAR_URL = 'https://transportation.uw.edu/park/events/calendar';

interface LotListProps {
    event: GuideEvent | null;
    parkingWindow: ParkingWindow;
    venue: Venue;
    /** The event's own venue, when the visitor is looking at another one. */
    eventVenue: Venue | null;
    venueName: (venue: Venue) => string;
    eventPricing: UwEventPricing[];
    views: LotView[];
    visibleViews: LotView[];
    query: string;
    onQuery: (query: string) => void;
    filters: ReadonlySet<LotFilter>;
    onToggleFilter: (filter: LotFilter) => void;
    hotCode: string | null;
    onHot: (code: string | null) => void;
    onOpenLot: (code: string) => void;
    onSelectVenue: (id: string) => void;
    tx: ParkingText;
}

/** "Sat, Oct 24 · 11 am – 5 pm", or both days for an event that runs past midnight. */
function EventWhen({event, tx}: {event: GuideEvent; tx: ParkingText}) {
    const startDate = event.start.slice(0, 10), startMin = clockMinutes(event.start.slice(11, 16));
    if (!event.end) return <><strong>{tx.date(startDate)}</strong> · {tx.time(startMin)}</>;
    const endDate = event.end.slice(0, 10), endMin = clockMinutes(event.end.slice(11, 16));
    if (endDate === startDate) return <><strong>{tx.date(startDate)}</strong> · {tx.range(startMin, endMin)}</>;
    return (
        <>
            <strong>{tx.date(startDate)}</strong>, {tx.time(startMin)} – <strong>{tx.date(endDate)}</strong>, {tx.time(endMin)}
        </>
    );
}

/** The guide's list view: the event, UW event-rate warnings, the suggested lots, then every lot. */
export const LotList = (props: LotListProps) => {
    const {
        event, parkingWindow, venue, eventVenue, venueName, eventPricing, views, visibleViews, query, onQuery, filters,
        onToggleFilter, hotCode, onHot, onOpenLot, onSelectVenue, tx
    } = props;
    const picks = views.filter(v => v.rank > 0).sort((a, b) => a.rank - b.rank);
    const banners = eventPricing.filter(p => p.date === parkingWindow.date);
    const name = venueName(venue);

    // Hovering a lot in the list lights up its pin and shows its card on the map.
    const hoverProps = (code: string) => ({
        onPointerEnter: (e: PointerEvent) => {
            if (e.pointerType === 'mouse') onHot(code);
        },
        onPointerLeave: (e: PointerEvent) => {
            if (e.pointerType === 'mouse') onHot(null);
        },
        onClick: () => onOpenLot(code),
    });

    return (
        <>
            <div className="parking-info-card">
                <div className="parking-info-icon parking-info-icon--time">🕐</div>
                <div className="parking-info-text parking-info-stack">
                    {event ? (
                        <>
                            <span className="parking-eyebrow">{tx.t('yourEvent')}</span>
                            <span
                                className="parking-event-title">{tx.isEnglish ? event.title.en || event.title.zh : event.title.zh || event.title.en}</span>
                            <span className="parking-meta"><EventWhen event={event} tx={tx}/></span>
                            {eventVenue && <span className="parking-meta">📍 {venueName(eventVenue)}</span>}
                        </>
                    ) : (
                        <>
                            <span className="parking-eyebrow">{tx.t('rightNow')}</span>
                            <span
                                className="parking-meta"><strong>{tx.date(parkingWindow.date)}</strong> · {tx.time(parkingWindow.start)}</span>
                            <span className="parking-meta">{tx.t('rightNowSub')}</span>
                        </>
                    )}
                    {eventVenue && eventVenue.id !== venue.id && (
                        <span className="parking-meta">
                            {tx.t('otherVenue', {v: name})}{' '}
                            <button type="button" className="parking-linkish"
                                    onClick={() => onSelectVenue(eventVenue.id)}>
                                {tx.t('backToEventVenue', {v: venueName(eventVenue)})}
                            </button>
                        </span>
                    )}
                </div>
            </div>

            {banners.map(p => (
                <div key={`${p.date}-${p.start}-${p.title}`} className="parking-info-card parking-banner" role="note">
                    <div className="parking-info-icon parking-info-icon--warn">⚠️</div>
                    <div className="parking-info-text parking-info-stack">
                        <span>
                            {p.allLots
                                ? tx.t('bannerAll', {d: tx.date(p.date), p: p.price, when: tx.pricingWhen(p)})
                                : tx.t('bannerSome', {
                                    d: tx.date(p.date),
                                    p: p.price,
                                    lots: p.lots.join(', '),
                                    when: tx.pricingWhen(p)
                                })}
                        </span>
                        <a href={UW_EVENT_CALENDAR_URL} target="_blank"
                           rel="noopener noreferrer">{tx.t('bannerSrc')} ↗</a>
                    </div>
                </div>
            ))}

            {picks.length > 0 && (
                <>
                    <div className="parking-section-title">
                        <h2>{tx.t('suggested', {v: name})}</h2>
                        <small>{tx.t('suggestedSub')}</small>
                    </div>
                    {picks.map(view => {
                        const {lot} = view;
                        const walk = walkText(view, tx, {venueName: name});
                        return (
                            <button
                                key={lot.code}
                                type="button"
                                className={`parking-info-card parking-pick${hotCode === lot.code ? ' is-hot' : ''}`}
                                {...hoverProps(lot.code)}
                            >
                                <span className="parking-info-icon parking-info-icon--num">{view.rank}</span>
                                <span className="parking-info-text parking-info-stack">
                                    <span className="parking-lot-name">
                                        {lot.code}{lot.name !== lot.code && ` · ${lot.name}`}
                                    </span>
                                    <span className="parking-lot-type">{tx.lotType(lot.type)}</span>
                                    <StatusPill status={view.status} tx={tx}/>
                                    <RatesLine rates={view.rates} tx={tx}/>
                                    {!parkingWindow.isNow && <NowLine view={view} tx={tx}/>}
                                    {walk && <span className="parking-dist">📍 {walk}</span>}
                                </span>
                            </button>
                        );
                    })}
                </>
            )}

            <div className="parking-section-title">
                <h2>{tx.t('all')}</h2>
                <small>{tx.t('lotsCount', {n: visibleViews.length})}</small>
            </div>
            <label className="parking-lot-search-field">
                <span className="parking-lot-search-icon" aria-hidden="true">🔍</span>
                <input
                    className="parking-lot-search-input"
                    type="search"
                    autoComplete="off"
                    value={query}
                    onChange={e => onQuery(e.target.value)}
                    placeholder={tx.t('searchLots')}
                    aria-label={tx.t('searchLots')}
                />
            </label>
            <div className="parking-chips">
                {LOT_FILTERS.map(f => (
                    <button
                        key={f}
                        type="button"
                        className="parking-chip"
                        aria-pressed={filters.has(f)}
                        onClick={() => onToggleFilter(f)}
                    >
                        {tx.t(f === 'free' && parkingWindow.isNow ? 'f_freeNow' : `f_${f}`)}
                    </button>
                ))}
            </div>
            <div className="parking-info-card parking-lot-list">
                {visibleViews.length === 0 ? (
                    <div className="parking-lot-search-empty">{tx.t('noLots')}</div>
                ) : visibleViews.map(view => {
                    const {lot, status} = view;
                    return (
                        <button
                            key={lot.code}
                            type="button"
                            className={`parking-lot-row${hotCode === lot.code ? ' is-hot' : ''}`}
                            {...hoverProps(lot.code)}
                        >
                            <span className={`parking-lot-badge parking-k-${status.kind}`}>{uwLotGlyph(lot.type)}</span>
                            <span className="parking-lot-row-body">
                                <span className="parking-lot-row-name">
                                    {lot.code}<span>{lotSubtitle(lot, tx.lotType(lot.type))}</span>
                                </span>
                                <span className="parking-lot-row-meta">{tx.status(status)}</span>
                            </span>
                            <span className="parking-lot-row-walk">{walkText(view, tx, {short: true})}</span>
                        </button>
                    );
                })}
            </div>
        </>
    );
};
