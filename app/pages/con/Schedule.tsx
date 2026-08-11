import { SCHEDULE, TRACKS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Schedule = () => {
    const t = useT();

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
                {SCHEDULE.map(block => (
                    <div key={block.id} className="sbc-schedule-block">
                        <h3 className="sbc-schedule-block-label">{t(block.label)}</h3>

                        <ol className="sbc-timeline">
                            {block.items.map(item => (
                                <li key={`${item.start}-${item.title.en}`} className="sbc-timeline-item">
                                    <div className="sbc-timeline-time">
                                        <span className="sbc-timeline-start">{item.start}</span>
                                        <span className="sbc-timeline-end">{item.end}</span>
                                    </div>

                                    <div className="sbc-timeline-body">
                                        <span className={`sbc-track-chip sbc-track-chip--${item.track}`}>
                                            {t(TRACKS[item.track])}
                                        </span>
                                        <h4 className="sbc-timeline-title">{t(item.title)}</h4>
                                        <p className="sbc-timeline-location">
                                            <span aria-hidden="true">📍 </span>
                                            {t(item.location)}
                                        </p>
                                        {item.detail && (
                                            <p className="sbc-timeline-detail">{t(item.detail)}</p>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                ))}
            </div>
        </section>
    );
};
