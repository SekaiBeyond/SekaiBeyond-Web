import { PAST_EVENTS } from "../Constants";

export const PastEvents = () => {
    return (
        <section id="events" className="section">
            <div className="section-header">
                <h2 className="section-title">Past Events</h2>
                <h3 className="section-title-cn">往期活动</h3>
                <p className="section-subtitle">
                    Check out the amazing events we've hosted!<br/>
                    查看我们举办过的精彩活动！
                </p>
            </div>

            <div className="events-grid">
                {PAST_EVENTS.map((event, index) => (
                    <div key={index} className="event-card">
                        <img className="event-image" src={event.icon} alt={event.title}/>
                        <div className="event-content">
                            <span className="event-badge">{event.badge}</span>
                            <h3 className="event-title">{event.title}</h3>
                            <p className="event-title-cn">{event.titleCn}</p>
                            <div className="event-date">
                                <span>📅</span>
                                <span>{event.date}</span>
                            </div>
                            <p className="event-description">
                                {event.description}<br/>
                                <span style={{fontSize: '13px', color: '#9a9a9a'}}>
                                                {event.descriptionCn}
                                            </span>
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </section>

    )
}