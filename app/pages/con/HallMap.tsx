import type { PointerEvent } from 'react';
import type { Vendor } from '~/lib/conContent';
import {
    HALL_COMPASS,
    HALL_DOORS,
    HALL_FLOOR,
    HALL_GRID_STYLE,
    HALL_LANDMARKS,
    HALL_TABLE_PLACES,
    type LandmarkKind,
} from '~/pages/con/hall';
import { type Localized, useT } from '~/pages/con/i18n';

const LANDMARK_LABELS: Record<LandmarkKind, Localized> = {
    stage: {en: 'Main Stage', zh: '主舞台'},
    cheer: {en: 'Free Cheering Space', zh: '自由应援区'},
    booth: {en: 'Photo Booth', zh: '拍照区'},
};

interface HallMapProps {
    /** Who is at each table. A table missing from it is drawn open. */
    vendors: ReadonlyMap<string, Vendor>;
    selected: string | null;
    onSelect: (table: string) => void;
    /** Mouse hover only, for a preview that does not pin anything. */
    onHover?: (table: string | null) => void;
    /** While a search is running, the tables it found; the rest are dimmed. */
    matches?: ReadonlySet<string> | null;
    /** Lets an open table be picked as well — the admin panel fills them in from here. */
    pickOpen?: boolean;
    label: string;
}

/**
 * The hall floor plan (see hall.ts), shared by /con and the admin editor.
 * Tables are out of the tab order: the vendor directory (on /con) or each
 * table's input (in admin) is the keyboard route, and sixty extra tab stops
 * would only be in the way. They stay named for screen readers.
 */
export const HallMap = ({vendors, selected, onSelect, onHover, matches, pickOpen, label}: HallMapProps) => {
    const t = useT();

    // Touch fires pointerenter too, and its hover would stick until the next tap.
    const hover = (table: string | null) => (e: PointerEvent) => {
        if (e.pointerType === 'mouse') onHover?.(table);
    };

    return (
        <div className="sbc-hall" role="group" aria-label={label}>
            <div className="sbc-hall-grid" style={HALL_GRID_STYLE}>
                <div className="sbc-hall-floor" style={HALL_FLOOR} aria-hidden="true"/>

                {HALL_DOORS.map(({wall, style}, i) => (
                    <div key={i} className="sbc-hall-door" data-wall={wall} style={style} aria-hidden="true"/>
                ))}

                {HALL_LANDMARKS.map(({kind, style}) => (
                    <div key={kind} className={`sbc-hall-landmark sbc-hall-landmark--${kind}`} style={style}>
                        <span>{t(LANDMARK_LABELS[kind])}</span>
                    </div>
                ))}

                <div className="sbc-hall-compass" style={HALL_COMPASS} aria-hidden="true">
                    <span className="sbc-hall-compass-arrow">→</span>
                    <span>N</span>
                </div>

                {HALL_TABLE_PLACES.map(({table, style}) => {
                    const vendor = vendors.get(table);
                    const dimmed = !!matches && !matches.has(table);
                    const cls = `sbc-hall-table${vendor ? '' : ' sbc-hall-table--open'}${
                        dimmed ? ' sbc-hall-table--dimmed' : ''}`;

                    if (!vendor && !pickOpen) {
                        return <div key={table} className={cls} style={style} aria-hidden="true">{table}</div>;
                    }

                    return (
                        <button
                            key={table}
                            type="button"
                            className={cls}
                            style={style}
                            data-table={table}
                            tabIndex={-1}
                            aria-pressed={selected === table}
                            aria-label={`${table}: ${vendor ? vendor.name : t({en: 'open table', zh: '空桌'})}`}
                            onClick={() => onSelect(table)}
                            onPointerEnter={hover(table)}
                            onPointerLeave={hover(null)}
                        >
                            {table}
                        </button>
                    );
                })}
            </div>

            <ul className="sbc-hall-legend" aria-hidden="true">
                <li><span className="sbc-hall-swatch"/>{t({en: 'Vendor', zh: '有摊主'})}</li>
                <li><span className="sbc-hall-swatch sbc-hall-swatch--open"/>{t({en: 'Open table', zh: '空桌'})}</li>
                <li><span className="sbc-hall-swatch sbc-hall-swatch--door"/>{t({en: 'Door', zh: '出入口'})}</li>
            </ul>
        </div>
    );
};
