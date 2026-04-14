import { useState } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { EventImageModal } from "~/components/EventImageModal";
import { usePastEvents } from "~/lib/pastEvents";
import { useTags } from "~/lib/tags";

export const PastEvents = () => {
    const {isEnglish} = useLanguage();
    const [showAll, setShowAll] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const {pastEvents, loading} = usePastEvents();
    const {tags} = useTags();

    if (loading) return null;

    const displayedEvents = showAll ? pastEvents : pastEvents.slice(0, 6);

    return (
        <section id="events" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Past Events" : "往期活动"}</h2>
                <p className="section-subtitle">{isEnglish ? "Check out the amazing events we've hosted!" : "查看我们举办过的精彩活动！"}</p>
            </div>

            <div className="events-grid">
                {displayedEvents.map((event) => (
                    <div key={event.id} className="event-card">
                        <img
                            className="event-image event-image--clickable"
                            src={event.icon}
                            alt={isEnglish ? event.title : event.titleCn}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedImage(event.icon)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedImage(event.icon);
                                }
                            }}
                        />
                        <div className="event-content">
                            <span className="event-label">{(() => {
                                const tag = tags.find(t => t.id === event.tagId);
                                return tag ? (isEnglish ? tag.name : tag.nameCn) : '';
                            })()}</span>
                            <h3 className="event-title">{isEnglish ? event.title : event.titleCn}</h3>
                            <div className="event-date">
                                <span>📅</span>
                                <span>{new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : "zh-CN", {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                    timeZone: 'UTC'
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
            <div className="show-more-container">
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

            {/* Event Image Modal */}
            {selectedImage && (
                <EventImageModal
                    imageUrl={selectedImage}
                    onClose={() => setSelectedImage(null)}
                    altText={isEnglish ? "Event detail" : "活动详情"}
                />
            )}
        </section>

    )
}