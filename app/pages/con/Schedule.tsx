import { useMemo } from 'react';
import { useConContent } from '~/lib/conContent';
import type { Room } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Schedule = () => {
    const t = useT();
    const {content} = useConContent();

    const roomsById = useMemo(
        () => new Map<string, Room>(content.rooms.map(room => [room.id, room])),
        [content.rooms],
    );

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

            <div className="sbc-schedule">
                {/* Keyed by position: block ids are generated and not guaranteed unique. */}
                {content.schedule.map((block, blockIndex) => (
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
                                                    <span className="sbc-timeline-start">{item.start}</span>
                                                    <span className="sbc-timeline-end">{item.end}</span>
                                                </>
                                            ) : (
                                                <span className="sbc-timeline-tba">
                                                    {t({en: 'TBA', zh: '待定'})}
                                                </span>
                                            )}
                                        </div>

                                        <div className="sbc-timeline-body">
                                            {room && (
                                                <span className={`sbc-room-chip sbc-room-chip--${room.accent}`}>
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
