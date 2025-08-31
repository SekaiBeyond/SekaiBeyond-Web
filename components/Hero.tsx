import { HashLink } from "react-router-hash-link";
import React from "react";

export const Hero = () => (
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
            <span className="hero-badge">ACG Student Organization @ UW 华大ACG社团</span>
            <div className="hero-title-wrapper">
                <h1 className="hero-title" data-text="Welcome to Sekai Beyond!">Welcome to Sekai Beyond!</h1>
                <span className="sparkle">✨</span>
                <span className="sparkle">⭐</span>
                <span className="sparkle">✨</span>
                <span className="sparkle">💫</span>
            </div>
            <h2 className="hero-title-cn">欢迎来到彼世界！</h2>
            <p className="hero-subtitle">
                University of Washington's Biggest Chinese Anime & Culture Club<br/>
                华盛顿大学最大的华人动漫社团
            </p>
            <p className="hero-description">
                Join 100+ members in celebrating anime, games, and ACG culture! From vedio games to anime,
                from cosplay to conventions, we're your home for all things otaku at UW.<br/>
                <span style={{fontSize: '0.95em', color: '#9a9a9a'}}>
                                    加入我们100+成员的大家庭，一起享受动漫、游戏和ACG文化的乐趣！
                                </span>
            </p>
            <div className="hero-buttons">
                <HashLink to="#contact" className="btn btn-primary">
                    <span>Become a Member 成为会员</span>
                    <span>🌸</span>
                </HashLink>
                <HashLink to="#events" className="btn btn-secondary">
                    <span>Explore Events 探索活动</span>
                    <span>✨</span>
                </HashLink>
            </div>
        </div>
        <div className="mascot-container">
            <div className="mascot">🐰</div>
            <div className="mascot">🐼</div>
            <div className="mascot">🦊</div>
        </div>
    </section>
)
