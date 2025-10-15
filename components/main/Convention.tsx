import React from "react";
import { CONVENTION_DATE, LINKS } from "../Constants";
import { useLanguage } from "../LanguageContextProvider";

export const Convention = () => {
    const {isEnglish} = useLanguage();

    return (
        <section id="convention" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Anime Convention" : "漫展"}</h2>
            </div>
            <div className="convention-banner">
                <div className="con-decorations">
                    {['🌸', '⭐', '👘', '🎮', '🎨', '✨'].map((emoji, i) => (
                        <div
                            key={i}
                            className="con-deco"
                            style={{
                                top: Math.random() * 100 + '%',
                                animationDelay: i * 2 + 's'
                            }}
                        >
                            {emoji}
                        </div>
                    ))}
                </div>
                <div style={{position: 'relative', zIndex: 2}}>
                    <span className="convention-label">{isEnglish ? "Coming Soon" : "即将到来"}</span>
                    <h2 className="convention-title">{isEnglish ? "SEKAI BEYOND CON" : "彼世界动漫游戏展"} {CONVENTION_DATE.getFullYear()}</h2>
                    <p style={{
                        fontSize: '24px',
                        color: '#ff8e53',
                        fontWeight: '700',
                        marginBottom: '20px'
                    }}>{CONVENTION_DATE.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}</p>
                    <p style={{
                        fontSize: '18px',
                        color: '#7a7a7a',
                        maxWidth: '700px',
                        margin: '0 auto 40px',
                        lineHeight: '1.6'
                    }}>
                        {isEnglish ? "The first-ever student-organized anime convention at UW!" : "华盛顿大学首届学生自主举办的漫展!"}
                    </p>
                    <div className="convention-poster" style={{marginTop: '40px'}}>
                        <img
                            src="/images/mika.png"
                            alt={isEnglish ? "SEKAI BEYOND CON Official Poster" : "彼世界动漫游戏展官方海报"}
                        />
                    </div>
                    <div className="convention-features">
                        <div className="con-feature">
                            <div className="con-feature-icon">🎵</div>
                            <div className="con-feature-title">{isEnglish ? "Band Performance" : "乐队演出"}</div>
                        </div>
                        <div className="con-feature">
                            <div className="con-feature-icon">🎤</div>
                            <div className="con-feature-title">KiraKira IdolFest</div>
                        </div>
                        <div className="con-feature">
                            <div className="con-feature-icon">🎨</div>
                            <div className="con-feature-title">{isEnglish ? "Artist Alley" : "画师摊位"}</div>
                        </div>
                        <div className="con-feature">
                            <div className="con-feature-icon">👘</div>
                            <div className="con-feature-title">{isEnglish ? "Cosplay Contest" : "Cosplay大赛"}</div>
                        </div>
                    </div>
                    <div className="hero-buttons" style={{marginTop: '40px'}}>
                        <a href={LINKS.buyTicket}
                           className="btn btn-primary con-btn">{isEnglish ? "Get Tickets" : "购票"}</a>
                        <a href={LINKS.convention}
                           className="btn btn-secondary con-btn">{isEnglish ? "Learn More" : "了解更多"}</a>
                    </div>
                </div>
            </div>
        </section>
    )
}