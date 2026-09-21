import { useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import type { RoomAccent, ScheduleItem } from '~/pages/con/content';
import type { Localized } from '~/pages/con/i18n';
import { useT } from '~/pages/con/i18n';
import { formatClockTime, pad } from '~/pages/con/utils';
import { SectionHeader } from '~/pages/con/SectionHeader';

/** How many minutes one grid row covers. Every time the admin panel accepts lands
 *  on a five, so a slot this size places each item on its exact start. */
const SLOT_MINUTES = 5;

/** Drawn height of an item that has a start but no end. */
const OPEN_ENDED_MINUTES = 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "13:30" → 810. Anything that is not a clock time reads as unscheduled. */
const minutesOf = (time: string | undefined): number | null => {
    const parts = time ? HHMM.exec(time) : null;
    return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null;
};

/** 810 → "13:30", back into the shape `formatClockTime` localises. */
const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

interface Placed {
    item: ScheduleItem
    start: number
    end: number
    /** Which sub-column of its room the item sits in. 0 unless something overlaps. */
    lane: number
}

interface Track {
    name: Localized
    accent: RoomAccent
    items: Placed[]
    lanes: number
    /** Index of this track's first lane among every lane in the grid. */
    offset: number
}

/**
 * Greedy interval packing: an item takes the first lane that is free by the time it
 * starts. Nothing in the run-of-show double-books a room, but the admin panel does
 * not stop it, and two boxes drawn on top of each other would hide an event
 * outright. Assumes `items` is already in start order.
 */
const packLanes = (items: Placed[]) => {
    const laneEnds: number[] = [];
    for (const placed of items) {
        const free = laneEnds.findIndex(end => end <= placed.start);
        placed.lane = free === -1 ? laneEnds.length : free;
        laneEnds[placed.lane] = placed.end;
    }
    return Math.max(laneEnds.length, 1);
};

/** A room id in the schedule that no room in the room list claims. */
const STRAY = {en: 'Elsewhere', zh: '其他场地'};

export const Schedule = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {content} = useConContent();
    const [roomFilter, setRoomFilter] = useState<string | null>(null);

    /**
     * Only rooms with something booked in them get a filter. A room can exist with
     * an empty day — the admin panel adds the room before the programming — and a
     * chip whose only possible result is an empty schedule is not a choice worth
     * offering. Ordered by the room list, not by the schedule, so the chips stay in
     * the order an admin arranged them.
     */
    const filterableRooms = useMemo(() => {
        const booked = new Set(content.schedule.flatMap(item => item.room ? [item.room] : []));
        return content.rooms.filter(room => booked.has(room.id));
    }, [content.rooms, content.schedule]);

    // Derived rather than corrected in an effect: if a refresh drops the room that
    // was selected, the filter falls back to "all" on the same render that loses it,
    // instead of briefly showing an empty schedule with no chip to explain why.
    const activeRoom = filterableRooms.some(room => room.id === roomFilter) ? roomFilter : null;

    /**
     * The grid: one track per room that has something on the clock, each packed into
     * lanes, plus the hour range they all share. Built from the filtered items so
     * that narrowing to one room narrows the clock to that room's day as well,
     * rather than leaving hours of empty column above and below it.
     */
    const grid = useMemo(() => {
        const byRoom = new Map<string, Placed[]>();
        for (const item of content.schedule) {
            if (activeRoom !== null && item.room !== activeRoom) continue;

            const start = minutesOf(item.start);
            if (start === null) continue;

            const stop = minutesOf(item.end);
            const end = stop !== null && stop > start ? stop : start + OPEN_ENDED_MINUTES;
            const placed: Placed = {item, start, end, lane: 0};

            const roomId = item.room ?? '';
            const existing = byRoom.get(roomId);
            if (existing) existing.push(placed);
            else byRoom.set(roomId, [placed]);
        }

        const tracks: Track[] = [];
        let lanes = 0;
        const addTrack = (name: Localized, accent: RoomAccent, items: Placed[]) => {
            items.sort((a, b) => a.start - b.start || a.end - b.end);
            const width = packLanes(items);
            tracks.push({name, accent, items, lanes: width, offset: lanes});
            lanes += width;
        };

        for (const room of content.rooms) {
            const items = byRoom.get(room.id);
            if (items) addTrack(room.name, room.accent, items);
        }

        // An item whose room id matches no room still happened, so it gets a column
        // of its own rather than being dropped off the page.
        const known = new Set(content.rooms.map(room => room.id));
        const stray = [...byRoom]
            .filter(([id]) => !known.has(id))
            .flatMap(([, items]) => items);
        if (stray.length > 0) addTrack(STRAY, 'slate', stray);

        if (tracks.length === 0) return null;

        const bounds = tracks.flatMap(track => track.items);
        const from = Math.floor(Math.min(...bounds.map(p => p.start)) / 60) * 60;
        const to = Math.ceil(Math.max(...bounds.map(p => p.end)) / 60) * 60;

        return {tracks, lanes, from, to, rows: (to - from) / SLOT_MINUTES};
    }, [content.rooms, content.schedule, activeRoom]);

    /**
     * Announced but unscheduled. There is no hour to hang these on, so they sit
     * under the grid rather than being dropped from the page.
     */
    const unscheduled = useMemo(
        () => content.schedule.filter(item =>
            minutesOf(item.start) === null && (activeRoom === null || item.room === activeRoom)),
        [content.schedule, activeRoom],
    );

    // Counted rather than written down, so editing the rooms in the admin panel
    // cannot leave the subtitle claiming a number of tracks that no longer exists.
    const tracks = content.rooms.length;
    const trackLine = tracks > 0
        ? {en: `One day, ${tracks} ${tracks === 1 ? 'track' : 'tracks'}. `, zh: `一天，${tracks} 条线路。`}
        : {en: '', zh: ''};

    // The header row sits above the slots, and grid lines are 1-based. Start times
    // round down and end times round up, so an odd minute never collapses an item
    // into a zero-height box.
    const lineAt = (minutes: number, round: (n: number) => number) =>
        round((minutes - (grid?.from ?? 0)) / SLOT_MINUTES) + 2;

    const hours = grid
        ? Array.from({length: (grid.to - grid.from) / 60}, (_, i) => grid.from + i * 60)
        : [];

    return (
        <section id="schedule" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Programming', zh: '节目安排'}}
                title={{en: 'Schedule', zh: '活动日程'}}
                subtitle={{
                    en: `${trackLine.en}Times may shift slightly on the day — check the board at registration.`,
                    zh: `${trackLine.zh}当天时间可能略有调整，请留意签到处的公告板。`,
                }}
            />

            {filterableRooms.length > 1 && (
                <div
                    className="sbc-schedule-filter"
                    role="group"
                    aria-label={t({en: 'Filter the schedule by room', zh: '按场地筛选日程'})}
                >
                    <button
                        type="button"
                        className="sbc-filter-chip"
                        aria-pressed={activeRoom === null}
                        onClick={() => setRoomFilter(null)}
                    >
                        {t({en: 'All rooms', zh: '全部场地'})}
                    </button>

                    {filterableRooms.map(room => (
                        <button
                            key={room.id}
                            type="button"
                            className={`sbc-filter-chip sbc-accent--${room.accent}`}
                            aria-pressed={activeRoom === room.id}
                            onClick={() => setRoomFilter(room.id)}
                        >
                            {t(room.name)}
                        </button>
                    ))}
                </div>
            )}

            <div className="sbc-schedule">
                {grid && (
                    <div
                        className="sbc-grid-scroll"
                        role="region"
                        tabIndex={0}
                        aria-label={t({en: 'Schedule by room', zh: '按场地排列的日程'})}
                    >
                        <div
                            className="sbc-grid"
                            style={{
                                gridTemplateColumns: `var(--sbc-grid-gutter) repeat(${grid.lanes}, minmax(var(--sbc-grid-column), 1fr))`,
                                gridTemplateRows: `auto repeat(${grid.rows}, minmax(var(--sbc-grid-slot), auto))`,
                            }}
                        >
                            <div className="sbc-grid-corner"/>

                            {grid.tracks.map(track => (
                                <h3
                                    key={track.offset}
                                    className={`sbc-grid-head sbc-accent--${track.accent}`}
                                    style={{gridColumn: `${track.offset + 2} / span ${track.lanes}`}}
                                >
                                    {t(track.name)}
                                </h3>
                            ))}

                            {/* The first hour needs no rule: the column headers sit on it. */}
                            {hours.slice(1).map(hour => (
                                <div
                                    key={`rule-${hour}`}
                                    className="sbc-grid-hour"
                                    aria-hidden="true"
                                    style={{gridRow: `${lineAt(hour, Math.round)} / span ${60 / SLOT_MINUTES}`}}
                                />
                            ))}

                            {hours.map(hour => (
                                <div
                                    key={`time-${hour}`}
                                    className="sbc-grid-time"
                                    style={{gridRow: `${lineAt(hour, Math.round)} / span ${60 / SLOT_MINUTES}`}}
                                >
                                    <span>{formatClockTime(clockOf(hour), currentLanguage)}</span>
                                </div>
                            ))}

                            {grid.tracks.map(track => track.items.map((placed, i) => {
                                const top = lineAt(placed.start, Math.floor);
                                const bottom = Math.max(lineAt(placed.end, Math.ceil), top + 1);
                                return (
                                    <article
                                        key={`${track.offset}-${i}`}
                                        className={`sbc-grid-event sbc-accent--${track.accent}`}
                                        style={{
                                            gridColumn: track.offset + 2 + placed.lane,
                                            gridRow: `${top} / ${bottom}`,
                                        }}
                                    >
                                        <p className="sbc-grid-event-time">
                                            {formatClockTime(clockOf(placed.start), currentLanguage)}
                                            {placed.item.end
                                                && ` – ${formatClockTime(placed.item.end, currentLanguage)}`}
                                        </p>
                                        <h4 className="sbc-grid-event-title">
                                            {/* The column header carries the room visually; read aloud,
                                                nothing else would say which room this is in. */}
                                            <span className="sbc-sr-only">{t(track.name)}: </span>
                                            {t(placed.item.title)}
                                        </h4>
                                        {placed.item.location && (
                                            <p className="sbc-grid-event-location">
                                                <span aria-hidden="true">📍 </span>
                                                {t(placed.item.location)}
                                            </p>
                                        )}
                                        {placed.item.detail && (
                                            <p className="sbc-grid-event-detail">{t(placed.item.detail)}</p>
                                        )}
                                    </article>
                                );
                            }))}
                        </div>
                    </div>
                )}

                {unscheduled.length > 0 && (
                    <div className="sbc-schedule-tba">
                        <h3 className="sbc-schedule-tba-label">
                            {t({en: 'Time to be confirmed', zh: '时间待定'})}
                        </h3>

                        <div className="sbc-tba-grid">
                            {/* No room chip: an item with no hour has no room either,
                                so these are neutral until both are settled. */}
                            {unscheduled.map((item, i) => (
                                <article key={i} className="sbc-tba-card sbc-accent--slate">
                                    <h4 className="sbc-grid-event-title">{t(item.title)}</h4>
                                    {item.location && (
                                        <p className="sbc-grid-event-location">
                                            <span aria-hidden="true">📍 </span>
                                            {t(item.location)}
                                        </p>
                                    )}
                                    {item.detail && (
                                        <p className="sbc-grid-event-detail">{t(item.detail)}</p>
                                    )}
                                </article>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
