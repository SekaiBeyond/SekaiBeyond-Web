import { type ReactNode, useEffect, useRef, useState } from 'react';
import { clockMinutes, DAY_MINUTES, daySchedule, type ParkingWindow, weeklyRates } from '~/lib/parkingStatus';
import type { ClockRange } from '~/lib/uwParking';
import { RatesLine, StatusPill, walkText } from './parts';
import type { LotView } from './model';
import type { ParkingText } from './text';

const UW_PARKING_MAP_URL = 'https://depts.washington.edu/tsevents/';

interface LotDetailProps {
    view: LotView;
    parkingWindow: ParkingWindow;
    venueName: string;
    /** Codes of the lots the guide lists, so overflow lots among them can be opened. */
    listedCodes: ReadonlySet<string>;
    onBack: () => void;
    onOpenLot: (code: string) => void;
    tx: ParkingText;
}

/** Why a lot has the status it has: its hours that day, against the event's. */
function whyText({status}: LotView, parkingWindow: ParkingWindow, tx: ParkingText): string {
    if (status.kind === 'event' && status.pricing) {
        return tx.t('whyEvent', {p: status.pricing.price, when: tx.pricingWhen(status.pricing)});
    }
    const when = parkingWindow.isNow
        ? tx.t('whyItsNow', {e: tx.time(parkingWindow.start)})
        : tx.t('whyYourEvent', {e: tx.range(parkingWindow.start, parkingWindow.end)});
    const join = (first: string) => tx.isEnglish ? `${first} ${when}` : `${first}${when}`;
    if (status.dow === 0) return join(tx.t('whySun'));
    const day = status.dow === 6 ? tx.t('sat') : tx.t('weekday');
    const limited = status.day.filter(s => s.segment !== 'free');
    if (limited.length === 0) return join(tx.t('whyNone', {day}));
    const key = limited.every(s => s.segment === 'pay') ? 'whyPaid' : 'whyHours';
    return join(tx.t(key, {day, w: tx.hours(status.day)}));
}

const rangeOf = (range: ClockRange, tx: ParkingText) =>
    tx.range(clockMinutes(range.start), clockMinutes(range.end) || DAY_MINUTES);

const SectionHead = ({icon, title, tone = 'info'}: {icon: string; title: ReactNode; tone?: 'info' | 'time'}) => (
    <div className="parking-detail-head">
        <span className={`parking-info-icon parking-info-icon--small parking-info-icon--${tone}`}
              aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
    </div>
);

/** Everything about one lot, in place of the list. */
export const LotDetail = ({
                              view,
                              parkingWindow,
                              venueName,
                              listedCodes,
                              onBack,
                              onOpenLot,
                              tx
                          }: LotDetailProps) => {
    const {lot, status, rank, note} = view;
    const [copied, setCopied] = useState(false);
    const zoneRef = useRef<HTMLSpanElement>(null);
    const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(copiedTimer.current), []);
    useEffect(() => setCopied(false), [lot.code]);

    // Only rates the lot can charge: W28 lists daytime rates, but it's permits only then.
    const rates = weeklyRates(lot);
    // When it has both kinds, each says which hours it's for.
    const ratePeriods = rates.some(r => r.unit === 'night') && rates.some(r => r.unit !== 'night');
    const rateLabel = {hour: 'hourly', day: 'daily', night: 'night'} as const;
    const stalls = ([['standard', 'P'], ['compact', 'C'], ['accessible', '♿'], ['motorcycle', 'M'], ['ev', '⚡']] as const)
        .filter(([key]) => (lot.stalls[key] ?? 0) > 0);
    const services = ([['zipcar', lot.zipcar], ['ucar', lot.ucar], ['dar', lot.dialARide]] as const).filter(([, on]) => on);
    const clearance = lot.clearanceInches
        ? tx.isEnglish
            ? tx.t('clearance', {
                ft: `${Math.floor(lot.clearanceInches / 12)}′${lot.clearanceInches % 12}″`,
                in: lot.clearanceInches
            })
            : tx.t('clearance', {m: (lot.clearanceInches * 0.0254).toFixed(2), in: lot.clearanceInches})
        : '';
    const walk = walkText(view, tx, {venueName});
    // "For Sat, Oct 24", the date in bold.
    const [forBefore, forAfter] = tx.t('secEvent').split('{d}');
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}&travelmode=driving`;

    const copyZone = () => {
        const done = () => {
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1600);
        };
        // Without clipboard access, select the number so it can be copied by hand.
        const selectIt = () => {
            const selection = document.getSelection();
            if (!zoneRef.current || !selection) return;
            const range = document.createRange();
            range.selectNodeContents(zoneRef.current);
            selection.removeAllRanges();
            selection.addRange(range);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(String(lot.payByPhoneZone)).then(done, selectIt);
        else selectIt();
    };

    return (
        <>
            <button type="button" className="parking-back-btn parking-detail-back" onClick={onBack}>
                <span className="parking-back-arrow">←</span>
                {tx.t('backList')}
            </button>

            <div className="parking-info-card parking-detail-title">
                <div className="parking-detail-code-row">
                    <span className="parking-detail-code">{lot.code}</span>
                    {rank > 0 && <span className="parking-pick-badge">{tx.t('pick', {n: rank})}</span>}
                </div>
                <div className="parking-detail-sub">
                    {[lot.name !== lot.code && lot.name, tx.lotType(lot.type), lot.area && tx.area(lot.area)]
                        .filter(Boolean).join(' · ')}
                </div>
            </div>

            <section className="parking-info-card parking-detail-card">
                <SectionHead
                    icon="🕐"
                    title={parkingWindow.isNow
                        ? tx.t('secNow')
                        : <>{forBefore}<strong>{tx.date(parkingWindow.date)}</strong>{forAfter}</>}
                    tone="time"
                />
                <StatusPill status={status} tx={tx}/>
                <RatesLine rates={view.rates} isNow={parkingWindow.isNow} tx={tx}/>
                <p>{whyText(view, parkingWindow, tx)}</p>
                {walk && (
                    <span
                        className="parking-dist">📍 {walk}{view.walk && ` · ${view.walk.meters} ${tx.isEnglish ? 'm' : '米'}`}</span>
                )}
                {note && (
                    <div className="parking-note">
                        <b>{tx.t('note')}</b>
                        {tx.isEnglish ? note.en || note.zh : note.zh || note.en}
                    </div>
                )}
                <div className="parking-actions">
                    <a className="parking-cta" href={directionsUrl} target="_blank" rel="noopener noreferrer">
                        🧭 {tx.t('directions')}
                    </a>
                </div>
            </section>

            <section className="parking-info-card parking-detail-card">
                <SectionHead icon="💲" title={tx.t('secRates')} tone="time"/>
                {rates.length > 0 ? (
                    <div className="parking-rates">
                        {rates.map(rate => (
                            <div key={rate.unit} className="parking-rate">
                                <b>{tx.money(rate.amount)}</b>
                                <span>{tx.t(rateLabel[rate.unit])}</span>
                                {ratePeriods && <small>{tx.rateWhen(rate)}</small>}
                            </div>
                        ))}
                    </div>
                ) : <p>{tx.t('noRate')}</p>}
            </section>

            <section className="parking-info-card parking-detail-card">
                <SectionHead icon="🗓️" title={tx.t('secHours')}/>
                <dl className="parking-kv">
                    <dt>{tx.t('accessLbl')}</dt>
                    <dd>{tx.t(lot.access === 'Pay to Park' ? 'access_pay' : 'access_pp')}</dd>
                    <dt>{tx.t('monFri')}</dt>
                    <dd>{tx.hours(daySchedule(lot, 1))}</dd>
                    <dt>{tx.t('sat')}</dt>
                    <dd>{tx.hours(daySchedule(lot, 6))}</dd>
                    <dt>{tx.t('sun')}</dt>
                    <dd>{tx.t('free')}</dd>
                    {lot.gateHours && (
                        <>
                            <dt>{tx.t('gate')}</dt>
                            <dd>{rangeOf(lot.gateHours, tx)}</dd>
                        </>
                    )}
                </dl>
            </section>

            {(lot.payByPhoneZone || lot.selfServe) && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="📱" title={tx.t('secPay')}/>
                    {!!lot.payByPhoneZone && (
                        <div className="parking-zone">
                            <div>
                                <div className="parking-eyebrow">{tx.t('pbp')}</div>
                                <span className="parking-zone-num" ref={zoneRef}>{lot.payByPhoneZone}</span>
                            </div>
                            <button type="button" className="parking-ghost" onClick={copyZone}>
                                📋 <span aria-live="polite">{tx.t(copied ? 'copied' : 'copy')}</span>
                            </button>
                        </div>
                    )}
                    {lot.selfServe && <p>{tx.t('selfServe')}</p>}
                </section>
            )}

            {stalls.length > 0 && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="🅿️" title={tx.t('secStalls')}/>
                    <div className="parking-stalls">
                        {stalls.map(([key, glyph]) => (
                            <div key={key} className="parking-stall">
                                <span className={`parking-info-icon parking-info-icon--small parking-stall--${key}`}
                                      aria-hidden="true">{glyph}</span>
                                <div>
                                    <b>{lot.stalls[key]}</b>
                                    <span>{tx.t(`s_${key}`)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {clearance && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="↕️" title={tx.t('secClear')}/>
                    <span className="parking-lot-name">{clearance}</span>
                </section>
            )}

            {lot.overflowLots.length > 0 && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="➡️" title={tx.t('secOverflow')}/>
                    <p>{tx.t('overflowLead')}</p>
                    <div className="parking-tags">
                        {lot.overflowLots.map(code => listedCodes.has(code) ? (
                            <button key={code} type="button" className="parking-tag"
                                    onClick={() => onOpenLot(code)}>{code}</button>
                        ) : (
                            <span key={code} className="parking-tag">{code}</span>
                        ))}
                    </div>
                </section>
            )}

            {services.length > 0 && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="🚗" title={tx.t('secAlso')}/>
                    <div className="parking-tags">
                        {services.map(([key]) => <span key={key} className="parking-tag">{tx.t(key)}</span>)}
                    </div>
                </section>
            )}

            {lot.hasTour && (
                <section className="parking-info-card parking-detail-card">
                    <SectionHead icon="📷" title={tx.t('secTour')}/>
                    <p>{tx.t('tourSub')}</p>
                    <div className="parking-actions">
                        <a className="parking-ghost" href={UW_PARKING_MAP_URL} target="_blank"
                           rel="noopener noreferrer">
                            🔄 {tx.t('tour')} ↗
                        </a>
                    </div>
                </section>
            )}
        </>
    );
};
