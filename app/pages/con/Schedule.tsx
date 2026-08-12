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

    return (
        <section id="schedule" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Programming', zh: '节目安排'}}
                title={{en: 'Schedule', zh: '活动日程'}}
                subtitle={{
                    en: 'One day, four tracks. Times may shift slightly on the day — check the board at registration.',
                    zh: '一天，四条线路。当天时间可能略有调整，请留意签到处的公告板。',
                }}
            />

            <div className="sbc-schedule">
                {content.schedule.map(block => (
                    <div key={block.id} className="sbc-schedule-block">
                        <h3 className="sbc-schedule-block-label">{t(block.label)}</h3>

                        <ol className="sbc-timeline">
                            {block.items.map((item, i) => {
                                const room = roomsById.get(item.room);
                                return (
                                    <li key={`${item.start ?? 'tba'}-${item.title.en}-${i}`}
                                        className="sbc-timeline-item">
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
