import React, { useEffect, useMemo, useState } from "react";
import { NO_UPCOMING_EVENT, UPCOMING_EVENT } from "../Constants";
import { useLanguage } from "../LanguageContextProvider";

export const UpcomingEvent = () => {
    const {isEnglish} = useLanguage();
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    });
    const [isPosterModalOpen, setIsPosterModalOpen] = useState(false);

    // Memoize decoration positions so they don't change on re-render
    const decorations = useMemo(() =>
            ['🌸', '⭐', '👘', '🎮', '🎨', '✨'].map((emoji, i) => ({
                emoji,
                top: Math.random() * 100,
                delay: i * 2
            }))
        , []);

    useEffect(() => {
        const calculateTimeLeft = () => {
            const difference = UPCOMING_EVENT.START_AT.getTime() - new Date().getTime();

            if (difference > 0) {
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60)
                });
            } else {
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
    }, []);

    return (
        <section id="upcoming" className="section" hidden={NO_UPCOMING_EVENT}>
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Upcoming Event" : "活动预告"}</h2>
            </div>
            <div className="convention-banner">
                <div className="con-decorations">
                    {decorations.map((deco, i) => (
                        <div
                            key={i}
                            className="con-deco"
                            style={{
                                top: deco.top + '%',
                                animationDelay: deco.delay + 's'
                            }}
                        >
                            {deco.emoji}
                        </div>
                    ))}
                </div>
                <div style={{position: 'relative', zIndex: 2}}>
                    <span className="convention-label">{isEnglish ? "Coming Soon" : "即将到来"}</span>
                    <h2 className="convention-title">{isEnglish ? UPCOMING_EVENT.NAME : UPCOMING_EVENT.NAME_CN}</h2>
                    <p style={{
                        fontSize: '24px',
                        color: '#ff8e53',
                        fontWeight: '700',
                        marginBottom: '20px'
                    }}>{UPCOMING_EVENT.START_AT.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                    })}</p>

                    <p style={{
                        fontSize: '18px',
                        color: '#7a7a7a',
                        maxWidth: '700px',
                        margin: '0 auto 40px',
                        lineHeight: '1.6'
                    }}>
                        {isEnglish ? UPCOMING_EVENT.DESCRIPTION : UPCOMING_EVENT.DESCRIPTION_CN}
                    </p>
                    <div className="convention-poster" style={{marginTop: '40px'}}
                         onClick={() => setIsPosterModalOpen(true)}>
                        <img
                            src={UPCOMING_EVENT.POSTER}
                            alt={isEnglish ? "Event Poster" : "活动海报"}
                        />
                        <p style={{
                            fontSize: '14px',
                            color: '#999',
                            marginTop: '14px',
                            fontStyle: 'italic'
                        }}>
                            {isEnglish ? `Poster by ${UPCOMING_EVENT.POSTER_CREDIT}` : `海报由 ${UPCOMING_EVENT.POSTER_CREDIT} 制作`}
                        </p>
                    </div>
                    {/* Countdown Timer */}
                    <div className="convention-features" style={{
                        display: 'flex',
                        gap: '20px',
                        justifyContent: 'center',
                        marginBottom: '30px',
                        flexWrap: 'wrap'
                    }}>
                        {[
                            {value: timeLeft.days, label: isEnglish ? 'Days' : '天'},
                            {value: timeLeft.hours, label: isEnglish ? 'Hours' : '时'},
                            {value: timeLeft.minutes, label: isEnglish ? 'Minutes' : '分'},
                            {value: timeLeft.seconds, label: isEnglish ? 'Seconds' : '秒'}
                        ].map((item, index) => (
                            <div key={index} style={{
                                backgroundColor: 'rgba(255, 142, 83, 0.1)',
                                borderRadius: '12px',
                                padding: '15px 25px',
                                minWidth: '90px',
                                border: '2px solid rgba(255, 142, 83, 0.3)'
                            }}>
                                <div style={{
                                    fontSize: '36px',
                                    fontWeight: 'bold',
                                    color: '#ff8e53',
                                    lineHeight: '1'
                                }}>
                                    {String(item.value).padStart(2, '0')}
                                </div>
                                <div style={{
                                    fontSize: '14px',
                                    color: '#7a7a7a',
                                    marginTop: '5px',
                                    textTransform: 'uppercase',
                                    fontWeight: '600'
                                }}>
                                    {item.label}
                                </div>
                            </div>
                        ))}
                    </div>
                    {UPCOMING_EVENT.BUY_TICKET || UPCOMING_EVENT.LEARN_MORE ? (
                        <div className="hero-buttons" style={{marginTop: '40px'}}>
                            {UPCOMING_EVENT.BUY_TICKET ? (<a href={UPCOMING_EVENT.BUY_TICKET}
                                                             className="btn btn-primary con-btn">{isEnglish ? "Get Tickets" : "购票"}</a>) : null}
                            {UPCOMING_EVENT.LEARN_MORE ? (<a href={UPCOMING_EVENT.LEARN_MORE}
                                                             className="btn btn-secondary con-btn">{isEnglish ? "Learn More" : "了解更多"}</a>) : null}
                        </div>) : null}
                </div>
            </div>

            {/* Poster Modal */}
            {isPosterModalOpen && (
                <div className="modal-overlay" onClick={() => setIsPosterModalOpen(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="modal-close"
                            onClick={() => setIsPosterModalOpen(false)}
                        >
                            ×
                        </button>
                        <div className="modal-body">
                            <img
                                src={UPCOMING_EVENT.POSTER}
                                alt={isEnglish ? "Event Poster" : "活动海报"}
                            />
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}