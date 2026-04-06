import { useEffect, useState } from "react";
import { type UpcomingEvent as UpcomingEventType, useUpcomingEvents } from "~/lib/upcomingEvents";
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
                <h2 className="convention-title">{isEnglish ? event.name : event.nameCn}</h2>
                <p className="event-date-text">{event.startAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                })}</p>
                <div className="convention-location">
                    {isEnglish ? event.location : event.locationCn}
                </div>
                <p className="event-description-text">
                    {isEnglish ? event.description : event.descriptionCn}
                </p>
                {event.poster && (
                    <div className="convention-poster convention-poster--spaced"
                         onClick={onPosterClick}>
                        <img src={event.poster} alt={isEnglish ? "Event Poster" : "活动海报"}/>
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
                {event.buyTicket || event.learnMore ? (
                    <div className="hero-buttons con-buttons">
                        {event.buyTicket ? (<a href={event.buyTicket}
                                               className="btn btn-primary con-btn">{isEnglish ? "Get Tickets" : "购票"}</a>) : null}
                        {event.learnMore ? (<a href={event.learnMore}
                                               className="btn btn-secondary con-btn">{isEnglish ? "Learn More" : "了解更多"}</a>) : null}
                    </div>) : null}
                {event.customButtonLink ? (
                    <a href={event.customButtonLink}
                       className="btn btn-secondary con-btn">{isEnglish ? event.customButtonText : event.customButtonTextCn}</a>
                ) : null}
            </div>
        </div>
    );
};

export const UpcomingEvent = () => {
    const {isEnglish} = useLanguage();
    const {upcomingEvents: allEvents} = useUpcomingEvents();
    const activeEvents = allEvents.filter(e => e.endAt > new Date());
    const [selectedPoster, setSelectedPoster] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

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

    const currentEvent = activeEvents[currentIndex];

    return (
        <section id="upcoming" className="section" hidden={activeEvents.length === 0}>
            <div className="section-header">
                <h2 className="section-title">{sectionTitle}</h2>
            </div>

            {currentEvent && (
                <div
                    className={`carousel-slide${isTransitioning ? (slideDirection === 'left' ? ' carousel-slide--hidden-left' : ' carousel-slide--hidden-right') : ''}`}
                >
                    <EventCard
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
