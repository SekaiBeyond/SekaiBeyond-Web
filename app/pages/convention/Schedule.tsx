import { useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type RoomAccent, type ScheduleItem, useConContent } from '~/lib/conContent';
import { type Localized, useT } from '~/pages/convention/i18n';
import { formatClockTime, pad, parseClockTime } from '~/pages/convention/utils';
import { SectionHeader } from '~/pages/convention/SectionHeader';

const SLOT_MINUTES = 5;

const OPEN_ENDED_MINUTES = 60;

const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

interface Placed {
    item: ScheduleItem;
    start: number;
    end: number;
    lane: number;
}

interface Track {
    name: Localized;
    accent: RoomAccent;
    items: Placed[];
    lanes: number;
    offset: number;
}

const packLanes = (items: Placed[]) => {
    const laneEnds: number[] = [];
    for (const placed of items) {
        const free = laneEnds.findIndex(end => end <= placed.start);
        placed.lane = free === -1 ? laneEnds.length : free;
        laneEnds[placed.lane] = placed.end;
    }
    return Math.max(laneEnds.length, 1);
};

export const Schedule = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {content} = useConContent();
    const [roomFilter, setRoomFilter] = useState<string | null>(null);

    const filterableRooms = useMemo(() => {
        const booked = new Set(content.schedule.flatMap(item => item.room ? [item.room] : []));
        return content.rooms.filter(room => booked.has(room.id));
    }, [content.rooms, content.schedule]);

    const activeRoom = filterableRooms.some(room => room.id === roomFilter) ? roomFilter : null;

    const grid = useMemo(() => {
        const byRoom = new Map<string, Placed[]>();
        for (const item of content.schedule) {
            if (activeRoom !== null && item.room !== activeRoom) continue;

            const start = parseClockTime(item.start);
            if (start === null) continue;

            const stop = parseClockTime(item.end);
            const end = stop !== null && stop > start ? stop : start + OPEN_ENDED_MINUTES;
            const placed: Placed = {item, start, end, lane: 0};

            const existing = byRoom.get(item.room ?? '');
            if (existing) existing.push(placed);
            else byRoom.set(item.room ?? '', [placed]);
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

        if (tracks.length === 0) return null;

        const bounds = tracks.flatMap(track => track.items);
        const from = Math.floor(Math.min(...bounds.map(p => p.start)) / 60) * 60;
        const to = Math.ceil(Math.max(...bounds.map(p => p.end)) / 60) * 60;

        return {tracks, lanes, from, to, rows: (to - from) / SLOT_MINUTES};
    }, [content.rooms, content.schedule, activeRoom]);

    const unscheduled = useMemo(
        () => content.schedule.filter(item =>
            parseClockTime(item.start) === null && (activeRoom === null || item.room === activeRoom)),
        [content.schedule, activeRoom],
    );

    const trackCount = useMemo(() => {
        const timed = new Set(content.schedule.flatMap(item =>
            item.room && parseClockTime(item.start) !== null ? [item.room] : []));
        return content.rooms.filter(room => timed.has(room.id)).length;
    }, [content.rooms, content.schedule]);
    const trackLine = trackCount > 0
        ? {
            en: `One day, ${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}. `,
            zh: `一天，${trackCount} 条线路。`,
        }
        : {en: '', zh: ''};

    const lineAt = (minutes: number, round: (n: number) => number) =>
        round((minutes - (grid?.from ?? 0)) / SLOT_MINUTES) + 2;

    const hours = grid
        ? Array.from({length: (grid.to - grid.from) / 60}, (_, i) => grid.from + i * 60)
        : [];

    return (
        <section id="schedule" className="sbc-section">
            <SectionHeader
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
                                            <span className="sbc-sr-only">{t(track.name)}: </span>
                                            {t(placed.item.title)}
                                        </h4>
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
                            {unscheduled.map((item, i) => (
                                <article key={i} className="sbc-tba-card sbc-accent--slate">
                                    <h4 className="sbc-grid-event-title">{t(item.title)}</h4>
                                </article>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
