import { useEffect, useState } from "react";
import { type UpcomingEvent as UpcomingEventType, useUpcomingEvents } from "~/lib/upcomingEvents";
import { useLanguage } from "~/components/LanguageContextProvider";
import { EventImageModal } from "~/components/EventImageModal";
import { isValidHttpUrl } from "~/lib/urls";
import { eventLocationDisplay, resolveVenueById, useVenues } from "~/lib/venues";

interface EventCardProps {
    event: UpcomingEventType;
    isEnglish: boolean;
    onPosterClick: () => void;
}

const EventCard = ({event, isEnglish, onPosterClick}: EventCardProps) => {
    const {venues} = useVenues();
    const parkingVenue = resolveVenueById(event.venueId, venues);
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    });
    const [isInProgress, setIsInProgress] = useState(false);

    useEffect(() => {
        const calculateTimeLeft = () => {
            const now = new Date().getTime();
            const startTime = event.startAt.getTime();
            const endTime = event.endAt.getTime();

            if (now < startTime) {
                setIsInProgress(false);
                const difference = startTime - now;
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60)
                });
            } else if (now >= startTime && now < endTime) {
                setIsInProgress(true);
                const difference = endTime - now;
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60)
                });
            } else {
                setIsInProgress(false);
                setTimeLeft({
                    days: 0,
                    hours: 0,
                    minutes: 0,
                    seconds: 0
                });
            }
        };

        calculateTimeLeft();
        const timer = setInterval(calculateTimeLeft, 1000);

        return () => clearInterval(timer);
    }, [event.startAt, event.endAt]);

    return (
        <div className="convention-banner">
            <div className="con-banner-inner">
                <span className={`convention-label${isInProgress ? ' convention-label--progress' : ''}`}>
                    {isInProgress
                        ? (isEnglish ? "Happening Now" : "进行中")
                        : (isEnglish ? "Coming Soon" : "即将到来")}
                </span>
                <h2 className="convention-title">{isEnglish ? event.title : event.titleCn}</h2>
                <p className="event-date-text">{event.startAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                })}</p>
                <div className="convention-location">
                    {eventLocationDisplay(event.location, event.locationCn, event.venueId, venues, isEnglish)}
                </div>
                <p className="event-description-text">
                    {isEnglish ? event.description : event.descriptionCn}
                </p>
                {event.poster && (
                    <div className="convention-poster convention-poster--spaced">
                        <button
                            type="button"
                            className="event-image-btn"
                            onClick={onPosterClick}
                            aria-label={isEnglish ? "View event poster" : "查看活动海报"}
                        >
                            <img
                                key={event.poster}
                                src={event.poster}
                                alt={isEnglish ? "Event Poster" : "活动海报"}
                            />
                        </button>
                        {event.posterCredit ? (
                            <p className="poster-credit">
                                {isEnglish ? `Poster by ${event.posterCredit}` : `海报由 ${event.posterCredit} 制作`}
                            </p>
                        ) : null}
                    </div>
                )}
                <div className="countdown-container">
                    {[
                        {value: timeLeft.days, label: isEnglish ? 'Days' : '天'},
                        {value: timeLeft.hours, label: isEnglish ? 'Hours' : '时'},
                        {value: timeLeft.minutes, label: isEnglish ? 'Minutes' : '分'},
                        {value: timeLeft.seconds, label: isEnglish ? 'Seconds' : '秒'}
                    ].map((item, index) => (
                        <div key={index} className={`countdown-item${isInProgress ? ' countdown-item--progress' : ''}`}>
                            <div className="countdown-value">
                                {String(item.value).padStart(2, '0')}
                            </div>
                            <div className="countdown-label">
                                {item.label}
                            </div>
                        </div>
                    ))}
                </div>
                {event.buyTicket || event.learnMore || event.customButtonLink || parkingVenue ? (
                    <div className="hero-buttons con-buttons">
                        {event.buyTicket && isValidHttpUrl(event.buyTicket) ? (
                            <a href={event.buyTicket} target="_blank" rel="noopener noreferrer"
                               className="btn btn-primary con-btn">{isEnglish ? "Get Tickets" : "购票"}</a>) : null}
                        {event.learnMore && isValidHttpUrl(event.learnMore) ? (
                            <a href={event.learnMore} target="_blank" rel="noopener noreferrer"
                               className="btn btn-secondary con-btn">{isEnglish ? "Learn More" : "了解更多"}</a>) : null}
                        {event.customButtonLink && isValidHttpUrl(event.customButtonLink) ? (
                            <a href={event.customButtonLink} target="_blank" rel="noopener noreferrer"
                               className="btn btn-secondary con-btn">{isEnglish ? event.customButtonText : event.customButtonTextCn}</a>) : null}
                        {parkingVenue && (
                            <a href={`/parking/${event.id}`} className="btn btn-parking con-btn">
                                <span className="parking-guide-link-icon">🅿️</span>
                                {isEnglish ? 'Parking Guide' : '停车指南'}
                            </a>
                        )}
                    </div>) : null}
            </div>
        </div>
    );
};

export const UpcomingEvent = () => {
    const {isEnglish} = useLanguage();
    const {activeEvents, loading} = useUpcomingEvents();
    const [selectedPoster, setSelectedPoster] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

    useEffect(() => {
        if (currentIndex >= activeEvents.length) {
            setCurrentIndex(0);
        }
    }, [activeEvents.length, currentIndex]);

    const hasMultipleEvents = activeEvents.length > 1;
    const sectionTitle = hasMultipleEvents
        ? (isEnglish ? "Upcoming Events" : "活动预告")
        : (isEnglish ? "Upcoming Event" : "活动预告");

    const switchEvent = (newIndex: number, direction: 'left' | 'right') => {
        if (newIndex === currentIndex || isTransitioning) return;
        setSlideDirection(direction);
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex(newIndex);
            setTimeout(() => setIsTransitioning(false), 50);
        }, 300);
    };

    const goToPrevious = () => {
        const newIndex = currentIndex === 0 ? activeEvents.length - 1 : currentIndex - 1;
        switchEvent(newIndex, 'right');
    };

    const goToNext = () => {
        const newIndex = currentIndex === activeEvents.length - 1 ? 0 : currentIndex + 1;
        switchEvent(newIndex, 'left');
    };

    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);

    const minSwipeDistance = 50;

    const onTouchStart = (e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e: React.TouchEvent) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        if (isLeftSwipe) {
            goToNext();
        } else if (isRightSwipe) {
            goToPrevious();
        }
    };

    const currentEvent = activeEvents[currentIndex];

    return (
        <section id="upcoming" className="section" hidden={!loading && activeEvents.length === 0}>
            <div className="section-header">
                <h2 className="section-title">{sectionTitle}</h2>
            </div>

            {loading ? (
                <div className="loading-container">
                    <div className="loader"></div>
                </div>
            ) : (
                <div
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    style={{touchAction: 'pan-y'}}
                >
                    {currentEvent && (
                        <div
                            className={`carousel-slide${isTransitioning ? (slideDirection === 'left' ? ' carousel-slide--hidden-left' : ' carousel-slide--hidden-right') : ''}`}
                        >
                            <EventCard
                                key={currentEvent.id}
                                event={currentEvent}
                                isEnglish={isEnglish}
                                onPosterClick={() => setSelectedPoster(currentEvent.poster)}
                            />
                        </div>
                    )}

                    {hasMultipleEvents && (
                        <div className="carousel-nav">
                            <button
                                className="carousel-nav-btn"
                                onClick={goToPrevious}
                                aria-label={isEnglish ? "Previous event" : "上一个活动"}
                            >
                                ‹
                            </button>

                            <div className="carousel-dots">
                                {activeEvents.map((_, index) => (
                                    <button
                                        key={index}
                                        className={`carousel-dot${currentIndex === index ? ' carousel-dot--active' : ''}`}
                                        onClick={() => switchEvent(index, index > currentIndex ? 'left' : 'right')}
                                        aria-label={`${isEnglish ? "Go to event" : "前往活动"} ${index + 1}`}
                                    />
                                ))}
                            </div>

                            <button
                                className="carousel-nav-btn"
                                onClick={goToNext}
                                aria-label={isEnglish ? "Next event" : "下一个活动"}
                            >
                                ›
                            </button>
                        </div>
                    )}
                </div>
            )}

            {selectedPoster && (
                <EventImageModal
                    imageUrl={selectedPoster}
                    onClose={() => setSelectedPoster(null)}
                    altText={isEnglish ? "Event Poster" : "活动海报"}
                />
            )}
        </section>
    );
}
