import { useState } from "react";
import { PAST_EVENTS, type PastEvent } from "../Constants";
import { useLanguage } from "../LanguageContextProvider";

export const PastEvents = () => {
    const {isEnglish} = useLanguage();
    const [showAll, setShowAll] = useState(false);

    const displayedEvents = showAll ? PAST_EVENTS : PAST_EVENTS.slice(0, 6);

    return (
        <section id="events" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Past Events" : "往期活动"}</h2>
                <p className="section-subtitle">{isEnglish ? "Check out the amazing events we've hosted!" : "查看我们举办过的精彩活动！"}</p>
            </div>

            <div className="events-grid">
                {displayedEvents.map((event: PastEvent, index: number) => (
                    <div key={index} className="event-card">
                        <img className="event-image" src={event.icon} alt={isEnglish ? event.title : event.titleCn}/>
                        <div className="event-content">
                            <span className="event-badge">{isEnglish ? event.badge : event.badgeCn}</span>
                            <h3 className="event-title">{isEnglish ? event.title : event.titleCn}</h3>
                            <div className="event-date">
                                <span>📅</span>
                                <span>{new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : "zh-CN", {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}</span>
                            </div>
                            <div className="event-date">
                                <span>📍</span>
                                <span>{event.location}</span>
                            </div>
                            <p className="event-description">
                                {isEnglish ? event.description : event.descriptionCn}<br/>
                            </p>
                        </div>
                    </div>
                ))}
            </div>
            <div style={{display: 'flex', justifyContent: 'center', marginTop: '3rem'}}>
                <button
                    onClick={() => setShowAll(!showAll)}
                    className="show-more-btn"
                >
                    <span className="show-more-text">
                        {showAll
                            ? (isEnglish ? "Show Less" : "收起")
                            : (isEnglish ? "Show More Events" : "查看更多活动")
                        }
                    </span>
                </button>
            </div>
        </section>

    )
}