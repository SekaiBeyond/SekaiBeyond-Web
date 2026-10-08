import { type MouseEvent, useMemo } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { FOUNDED_DATE } from "~/constants";
import { usePastEvents } from "~/lib/pastEvents";
import { useUpcomingEvents } from "~/lib/upcomingEvents";

const generateBubbleStyles = () =>
    Array.from({length: 6}, () => ({
        width: Math.random() * 25 + 10 + 'em',
        height: Math.random() * 25 + 10 + 'em',
        left: Math.random() * 100 + '%',
        top: Math.random() * 100 + '%',
        animationDelay: Math.random() * 5 + 's'
    }));

const yearsSince = (from: Date) => {
    const now = new Date();
    let years = now.getFullYear() - from.getFullYear();
    const m = now.getMonth() - from.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < from.getDate())) years--;
    return years;
};

export const Hero = () => {
    const {isEnglish} = useLanguage();
    const bubbleStyles = useMemo(generateBubbleStyles, []);
    const {activeEvents, loading: upcomingLoading} = useUpcomingEvents();
    const {pastEvents, loading: pastLoading} = usePastEvents();

    // While events load, their buttons are rendered invisibly so the hero keeps its
    // height instead of jumping when they appear. Once loaded, a button with
    // nothing behind it is dropped, matching the navbar and the hidden sections.
    const showUpcoming = upcomingLoading || activeEvents.length > 0;
    const showPast = pastLoading || pastEvents.some(e => e.published);

    const scrollTo = (e: MouseEvent, id: string) => {
        e.preventDefault();
        document.getElementById(id)?.scrollIntoView({behavior: "smooth"});
    };

    return (
        <section id="home" className="hero">
            <div className="hero-decoration">
                {bubbleStyles.map((style, i) => (
                    <div
                        key={i}
                        className="bubble"
                        style={style}
                    />
                ))}
            </div>
            <div className="hero-content">
                <span
                    className="hero-badge">{isEnglish ? 'Registered Student Organization @ University of Washington' : '华盛顿大学的学生社团'}</span>
                <h1 className="hero-title">{isEnglish ? "Welcome to Sekai Beyond!" : "欢迎来到彼世界!"}</h1>
                <p className="hero-subtitle">{isEnglish ? "A creative community for anime, gaming, cosplay, and creation." : '一个面向动漫、游戏、Cosplay 与开发的创作社区'}
                </p>
                <p className="hero-description">
                    {isEnglish
                        ? "Join us to explore anime, games, cosplay, and creative projects—from game nights to game dev, from J‑pop to conventions—everyone’s welcome"
                        : '加入我们一起参与动漫、游戏、Cosplay与创作活动：从游戏夜到游戏开发，从舞台表演到展会，欢迎所有同学参与'
                    }
                </p>
                <div className="hero-buttons hero-actions">
                    <a href="#contact" className="btn btn-primary" onClick={(e) => scrollTo(e, "contact")}>
                        <span>{isEnglish ? "Become a Member" : "成为会员"}</span>
                        <span>🌸</span>
                    </a>
                    {showUpcoming && (
                        <a href="#upcoming"
                           className={`btn btn-secondary${upcomingLoading ? ' hero-action--pending' : ''}`}
                           aria-hidden={upcomingLoading || undefined} tabIndex={upcomingLoading ? -1 : undefined}
                           onClick={(e) => scrollTo(e, "upcoming")}>
                            <span>{isEnglish ? (activeEvents.length === 1 ? "Upcoming Event" : "Upcoming Events") : "活动预告"}</span>
                            <span>✨</span>
                        </a>
                    )}
                    {showPast && (
                        <a href="#events" className={`btn btn-secondary${pastLoading ? ' hero-action--pending' : ''}`}
                           aria-hidden={pastLoading || undefined} tabIndex={pastLoading ? -1 : undefined}
                           onClick={(e) => scrollTo(e, "events")}>
                            <span>{isEnglish ? "Past Events" : "往期活动"}</span>
                            <span>📸</span>
                        </a>
                    )}
                </div>
                <div className="stats-container">
                    <div className="stat-item">
                        <div className="stat-number">400+</div>
                        <div className="stat-label">{isEnglish ? "Active Members" : "活跃成员"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">10+</div>
                        <div className="stat-label">{isEnglish ? "Events Per Year" : "年度活动"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">{yearsSince(FOUNDED_DATE)}</div>
                        <div className="stat-label">{isEnglish ? "Years Active" : "成立年数"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">600+</div>
                        <div className="stat-label">{isEnglish ? "Followers" : "社交媒体粉丝"}</div>
                    </div>
                </div>
            </div>
        </section>
    )
}
