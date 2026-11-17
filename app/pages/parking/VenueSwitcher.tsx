import { useEffect, useRef, useState } from 'react';
import { useDismiss } from '~/lib/useDismiss';
import { walkMinutes } from '~/lib/uwParking';
import { localizedVenueName, type Venue } from '~/lib/venues';
import type { ParkingText } from './text';

interface VenueSwitcherProps {
    venues: Venue[];
    selectedId: string;
    eventVenueId: string;
    suggestionFor: (venue: Venue) => {code: string; walk: {seconds: number} | null} | null;
    onSelect: (id: string) => void;
    tx: ParkingText;
}

export const VenueSwitcher = ({venues, selectedId, eventVenueId, suggestionFor, onSelect, tx}: VenueSwitcherProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selected = venues.find(v => v.id === selectedId) ?? null;
    const triggerLabel = selected ? localizedVenueName(selected, tx.isEnglish) : tx.t('allCampus');

    const q = query.trim().toLowerCase();
    const filtered = q
        ? venues.filter(v => v.nameEn.toLowerCase().includes(q) || v.nameCn.toLowerCase().includes(q)
            || v.buildingCode.toLowerCase().includes(q))
        : venues;
    const showCampus = !q || tx.t('allCampus').toLowerCase().includes(q);

    useDismiss(open, containerRef, byEscape => {
        setOpen(false);
        if (byEscape) triggerRef.current?.focus();
    });

    useEffect(() => {
        if (open) inputRef.current?.focus();
        else setQuery('');
    }, [open]);

    const choose = (id: string) => {
        onSelect(id);
        setOpen(false);
    };

    const optionMeta = (v: Venue): string => {
        const parts: string[] = [];
        if (v.buildingCode) parts.push(tx.t('venueCode', {c: v.buildingCode}));
        const first = suggestionFor(v);
        if (first) {
            parts.push(first.walk
                ? `🅿️ ${first.code}, ${tx.t('walkShort', {n: walkMinutes(first.walk.seconds)})}`
                : `🅿️ ${first.code}`);
        }
        return parts.join(' · ');
    };

    return (
        <div className="parking-venue-switcher" ref={containerRef}>
            <button
                ref={triggerRef}
                type="button"
                className="parking-venue-switcher-trigger"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className="parking-venue-switcher-name">{triggerLabel}</span>
                <span className="parking-venue-switcher-chevron-badge">
                    <span className={`parking-venue-switcher-chevron${open ? ' is-open' : ''}`}>▾</span>
                </span>
            </button>

            {open && (
                <div className="parking-venue-switcher-panel">
                    <input
                        ref={inputRef}
                        className="parking-venue-switcher-search"
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={tx.t('searchVenues')}
                        aria-label={tx.t('searchVenues')}
                    />
                    <div className="parking-venue-switcher-list" role="listbox">
                        {showCampus && (
                            <button
                                type="button"
                                role="option"
                                aria-selected={!selected}
                                className={`parking-venue-switcher-option${!selected ? ' is-active' : ''}`}
                                onClick={() => choose('')}
                            >
                                <span className="parking-venue-switcher-option-name">{tx.t('allCampus')}</span>
                                <span className="parking-venue-switcher-option-meta">{tx.t('allCampusSub')}</span>
                                {!selected && <span className="parking-venue-switcher-check">✓</span>}
                            </button>
                        )}
                        {filtered.length === 0 ? (
                            !showCampus && <div className="parking-venue-switcher-empty">{tx.t('noVenues')}</div>
                        ) : (
                            filtered.map(v => {
                                const active = v.id === selectedId;
                                const meta = optionMeta(v);
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        className={`parking-venue-switcher-option${active ? ' is-active' : ''}`}
                                        onClick={() => choose(v.id)}
                                    >
                                        <span className="parking-venue-switcher-option-name">
                                            {localizedVenueName(v, tx.isEnglish)}
                                            {v.id === eventVenueId && (
                                                <span className="parking-venue-switcher-tag">{tx.t('thisEvent')}</span>
                                            )}
                                        </span>
                                        {meta && <span className="parking-venue-switcher-option-meta">{meta}</span>}
                                        {active && <span className="parking-venue-switcher-check">✓</span>}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
