import { HashLink } from "react-router-hash-link";
import React from "react";
import { useLanguage } from "../LanguageContextProvider";

export const Hero = () => {
    const {isEnglish} = useLanguage();

    return (
        <section id="home" className="hero">
            <div className="hero-decoration">
                {[...Array(6)].map((_, i) => (
                    <div
                        key={i}
                        className="bubble"
                        style={{
                            width: Math.random() * 200 + 100 + 'px',
                            height: Math.random() * 200 + 100 + 'px',
                            left: Math.random() * 100 + '%',
                            top: Math.random() * 100 + '%',
                            animationDelay: Math.random() * 5 + 's'
                        }}
                    />
                ))}
            </div>
            <div className="hero-content">
                <span
                    className="hero-badge">{isEnglish ? 'An ACG Student Organization @ UW' : '一个华盛顿大学的ACG学生社团'}</span>
                <div className="hero-title-wrapper">
                    {isEnglish ?
                        (<h1 className="hero-title" data-text="Welcome to Sekai Beyond!">Welcome to Sekai
                            Beyond!</h1>) :
                        (<h1 className="hero-title" data-text="欢迎来到彼世界!">欢迎来到<br/>彼世界!</h1>)
                    }
                    <span className="sparkle">✨</span>
                    <span className="sparkle">⭐</span>
                    <span className="sparkle">✨</span>
                    <span className="sparkle">💫</span>
                </div>
                <p className="hero-subtitle">{isEnglish ? "University of Washington's Biggest Chinese Anime & Culture Club" : '华盛顿大学最大的华人动漫社团'}
                </p>
                <p className="hero-description">
                    {isEnglish ? "Join 100+ members in celebrating anime, games, and ACG culture! From video games to anime, from cosplay to conventions, we're your home for all things otaku at UW." : '加入我们100+成员的大家庭，一起享受动漫、游戏和ACG文化的乐趣！'}
                </p>
                <div className="hero-buttons">
                    <HashLink to="#contact" className="btn btn-primary">
                        <span>{isEnglish ? "Become a Member" : "成为会员"}</span>
                        <span>🌸</span>
                    </HashLink>
                    <HashLink to="#events" className="btn btn-secondary">
                        <span>{isEnglish ? "Explore Events" : "探索活动"}</span>
                        <span>✨</span>
                    </HashLink>
                </div>
                <div className="stats-container">
                    <div className="stat-item">
                        <div className="stat-number">100+</div>
                        <div className="stat-label">{isEnglish ? "Active Members" : "活跃成员"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">10+</div>
                        <div className="stat-label">{isEnglish ? "Events Per Year" : "年度活动"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">1</div>
                        <div className="stat-label">{isEnglish ? "Years Active" : "成立年数"}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">300+</div>
                        <div className="stat-label">{isEnglish ? "Followers" : "社交媒体粉丝"}</div>
                    </div>
                </div>
            </div>
            <div className="mascot-container">
                <div className="mascot">🐰</div>
                <div className="mascot">🐼</div>
                <div className="mascot">🦊</div>
            </div>
        </section>
    )
}
