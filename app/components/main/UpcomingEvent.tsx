import React, { useEffect, useState } from "react";
import { UPCOMING_EVENTS, type UpcomingEventType } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";
import { EventImageModal } from "~/components/EventImageModal";

interface EventCardProps {
    event: UpcomingEventType;
    isEnglish: boolean;
    onPosterClick: () => void;
}

const EventCard = ({event, isEnglish, onPosterClick}: EventCardProps) => {
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
            const startTime = event.START_AT.getTime();
            const endTime = event.END_AT.getTime();

            if (now < startTime) {
                // Event hasn't started yet - countdown to start
                setIsInProgress(false);
                const difference = startTime - now;
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60)
                });
            } else if (now >= startTime && now < endTime) {
                // Event is in progress - countdown to end
                setIsInProgress(true);
                const difference = endTime - now;
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60)
                });
            } else {
                // Event has ended
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
    }, [event.START_AT, event.END_AT]);

    return (
        <div className="convention-banner">
            <div style={{position: 'relative', zIndex: 2}}>
                <span className="convention-label" style={isInProgress ? {
                    background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
                } : undefined}>
                    {isInProgress
                        ? (isEnglish ? "Happening Now" : "进行中")
                        : (isEnglish ? "Coming Soon" : "即将到来")}
                </span>
                <h2 className="convention-title">{isEnglish ? event.NAME : event.NAME_CN}</h2>
                {/* Event Date & Time */}
                <p className="event-date-text">{event.START_AT.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                })}</p>
                {/* Event Location */}
                <div className="convention-location">
                    {isEnglish ? event.LOCATION : event.LOCATION_CN}
                </div>
                {/* Event Description */}
                <p className="event-description-text">
                    {isEnglish ? event.DESCRIPTION : event.DESCRIPTION_CN}
                </p>
                <div className="convention-poster" style={{marginTop: '2rem'}}
                     onClick={onPosterClick}>
                    <img src={event.POSTER} alt={isEnglish ? "Event Poster" : "活动海报"}/>
                    {event.POSTER_CREDIT ? (
                        <p className="poster-credit">
                            {isEnglish ? `Poster by ${event.POSTER_CREDIT}` : `海报由 ${event.POSTER_CREDIT} 制作`}
                        </p>
                    ) : null}
                </div>
                {/* Countdown Timer */}
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
                {event.BUY_TICKET || event.LEARN_MORE ? (
                    <div className="hero-buttons" style={{marginTop: '40px'}}>
                        {event.BUY_TICKET ? (<a href={event.BUY_TICKET}
                                                className="btn btn-primary con-btn">{isEnglish ? "Get Tickets" : "购票"}</a>) : null}
                        {event.LEARN_MORE ? (<a href={event.LEARN_MORE}
                                                className="btn btn-secondary con-btn">{isEnglish ? "Learn More" : "了解更多"}</a>) : null}
                    </div>) : null}
                {event.CUSTOM_BUTTON_LINK ? (
                    <a href={event.CUSTOM_BUTTON_LINK}
                       className="btn btn-secondary con-btn">{isEnglish ? event.CUSTOM_BUTTON_TEXT : event.CUSTOM_BUTTON_TEXT_CN}</a>
                ) : null}
            </div>
        </div>
    );
};

export const UpcomingEvent = () => {
    const {isEnglish} = useLanguage();
    const [selectedPoster, setSelectedPoster] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

    const hasMultipleEvents = UPCOMING_EVENTS.length > 1;
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
        const newIndex = currentIndex === 0 ? UPCOMING_EVENTS.length - 1 : currentIndex - 1;
        switchEvent(newIndex, 'right');
    };

    const goToNext = () => {
        const newIndex = currentIndex === UPCOMING_EVENTS.length - 1 ? 0 : currentIndex + 1;
        switchEvent(newIndex, 'left');
    };

    const currentEvent = UPCOMING_EVENTS[currentIndex];

    return (
        <section id="upcoming" className="section" hidden={UPCOMING_EVENTS.length === 0}>
            <div className="section-header">
                <h2 className="section-title">{sectionTitle}</h2>
            </div>

            {/* Current Event */}
            {currentEvent && (
                <div
                    className="carousel-slide"
                    style={{
                        opacity: isTransitioning ? 0 : 1,
                        transform: isTransitioning
                            ? `translateX(${slideDirection === 'left' ? '-30px' : '30px'})`
                            : 'translateX(0)',
                    }}
                >
                    <EventCard
                        event={currentEvent}
                        isEnglish={isEnglish}
                        onPosterClick={() => setSelectedPoster(currentEvent.POSTER)}
                    />
                </div>
            )}

            {/* Event Navigation - only show if multiple events */}
            {hasMultipleEvents && (
                <div className="carousel-nav">
                    <button
                        className="carousel-nav-btn"
                        onClick={goToPrevious}
                        aria-label={isEnglish ? "Previous event" : "上一个活动"}
                    >
                        ‹
                    </button>

                    {/* Dot indicators */}
                    <div className="carousel-dots">
                        {UPCOMING_EVENTS.map((_, index) => (
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

            {/* Poster Modal */}
            {selectedPoster && (
                <EventImageModal
                    imageUrl={selectedPoster}
                    onClose={() => setSelectedPoster(null)}
                    altText={isEnglish ? "Event Poster" : "活动海报"}
                />
            )}
        </section>
    )
}
