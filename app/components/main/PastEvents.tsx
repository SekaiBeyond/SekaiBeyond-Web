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

    const publishedEvents = pastEvents.filter(e => e.published);
    const displayedEvents = showAll ? publishedEvents : publishedEvents.slice(0, 6);

    return (
        <section id="events" className="section" hidden={!loading && publishedEvents.length === 0}>
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Past Events" : "往期活动"}</h2>
                <p className="section-subtitle">{isEnglish ? "Check out the amazing events we've hosted!" : "查看我们举办过的精彩活动！"}</p>
            </div>

            {loading ? (
                <div className="loading-container">
                    <div className="loader"></div>
                </div>
            ) : (
                <>
                    <div className="events-grid">
                        {displayedEvents.map((event) => (
                            <div key={event.id} className="event-card">
                                <button
                                    type="button"
                                    className="event-image-btn"
                                    onClick={() => setSelectedImage(event.icon)}
                                    aria-label={isEnglish ? `View ${event.title} photo` : `查看${event.titleCn}照片`}
                                >
                                    <img
                                        className="event-image"
                                        src={event.icon}
                                        alt={isEnglish ? event.title : event.titleCn}
                                    />
                                </button>
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
                                        <span>{(isEnglish ? event.location : (event.locationCn || event.location))}</span>
                                    </div>
                                    <p className="event-description">
                                        {isEnglish ? event.description : event.descriptionCn}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                    {publishedEvents.length > 6 && (
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
                    )}
                </>
            )}

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