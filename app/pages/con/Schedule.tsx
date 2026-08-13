import { useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import type { Room } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { formatClockTime } from '~/pages/con/utils';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Schedule = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {content} = useConContent();
    const [roomFilter, setRoomFilter] = useState<string | null>(null);

    const roomsById = useMemo(
        () => new Map<string, Room>(content.rooms.map(room => [room.id, room])),
        [content.rooms],
    );

    /**
     * Only rooms with something booked in them get a filter. A room can exist with
     * an empty day — the admin panel adds the room before the programming — and a
     * chip whose only possible result is an empty schedule is not a choice worth
     * offering. Ordered by the room list, not by the schedule, so the chips stay in
     * the order an admin arranged them.
     */
    const filterableRooms = useMemo(() => {
        const booked = new Set(
            content.schedule.flatMap(block => block.items.map(item => item.room)),
        );
        return content.rooms.filter(room => booked.has(room.id));
    }, [content.rooms, content.schedule]);

    // Derived rather than corrected in an effect: if a refresh drops the room that
    // was selected, the filter falls back to "all" on the same render that loses it,
    // instead of briefly showing an empty schedule with no chip to explain why.
    const activeRoom = filterableRooms.some(room => room.id === roomFilter) ? roomFilter : null;

    const blocks = useMemo(() => {
        if (activeRoom === null) return content.schedule;
        return content.schedule
            .map(block => ({...block, items: block.items.filter(item => item.room === activeRoom)}))
            // A block with nothing in this room is dropped whole, so the filtered
            // view does not show a run of empty headings.
            .filter(block => block.items.length > 0);
    }, [content.schedule, activeRoom]);

    // Counted rather than written down, so editing the rooms in the admin panel
    // cannot leave the subtitle claiming a number of tracks that no longer exists.
    const tracks = content.rooms.length;
    const trackLine = tracks > 0
        ? {en: `One day, ${tracks} ${tracks === 1 ? 'track' : 'tracks'}. `, zh: `一天，${tracks} 条线路。`}
        : {en: '', zh: ''};

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
                {/* Keyed by position: block ids are generated and not guaranteed unique. */}
                {blocks.map((block, blockIndex) => (
                    <div key={blockIndex} className="sbc-schedule-block">
                        <h3 className="sbc-schedule-block-label">{t(block.label)}</h3>

                        <ol className="sbc-timeline">
                            {block.items.map((item, i) => {
                                const room = roomsById.get(item.room);
                                return (
                                    <li key={i} className="sbc-timeline-item">
                                        <div className="sbc-timeline-time">
                                            {item.start ? (
                                                <>
                                                    <span className="sbc-timeline-start">
                                                        {formatClockTime(item.start, currentLanguage)}
                                                    </span>
                                                    <span className="sbc-timeline-end">
                                                        {item.end && formatClockTime(item.end, currentLanguage)}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="sbc-timeline-tba">
                                                    {t({en: 'TBA', zh: '待定'})}
                                                </span>
                                            )}
                                        </div>

                                        <div className="sbc-timeline-body">
                                            {room && (
                                                <span className={`sbc-room-chip sbc-accent--${room.accent}`}>
                                                    {t(room.name)}
                                                </span>
                                            )}
                                            <h4 className="sbc-timeline-title">{t(item.title)}</h4>
                                            {item.location && (
                                                <p className="sbc-timeline-location">
                                                    <span aria-hidden="true">📍 </span>
                                                    {t(item.location)}
                                                </p>
                                            )}
                                            {item.detail && (
                                                <p className="sbc-timeline-detail">{t(item.detail)}</p>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                ))}
            </div>
        </section>
    );
};
