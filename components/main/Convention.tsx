import React from "react";
import { LINKS } from "./Constants";

export const Convention = () => (
    <section id="convention" className="convention-section section">
        <div className="section-header">
            <h2 className="section-title">Annual Anime Convention</h2>
            <h3 className="section-title-cn">年度漫展</h3>
        </div>
        <div className="convention-banner">
            <div className="con-decorations">
                {['🌸', '⭐', '🎌', '🎮', '🎨'].map((emoji, i) => (
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
                <span className="convention-label">Coming Soon 即将到来</span>
                <h2 className="convention-title">SEKAI BEYOND CON 2025</h2>
                <p className="convention-title-cn">彼世界动漫游戏展 2025</p>
                <p style={{fontSize: '24px', color: '#ff8e53', fontWeight: '700', marginBottom: '20px'}}>
                    October 11, 2025 • 2025年10月11日
                </p>
                <p style={{
                    fontSize: '18px',
                    color: '#7a7a7a',
                    maxWidth: '700px',
                    margin: '0 auto 40px',
                    lineHeight: '1.6'
                }}>
                    One of the biggest student-run anime convention in the Pacific Northwest!<br/>
                    <span style={{fontSize: '16px', color: '#9a9a9a'}}>
                                        太平洋西北地区最大的学生动漫游戏展之一！
                                    </span>
                </p>
                <div className="convention-features">
                    <div className="con-feature">
                        <div className="con-feature-icon">🎤</div>
                        <div className="con-feature-title">Voice Actors</div>
                        <div style={{fontSize: '12px', color: '#9a9a9a'}}>声优嘉宾</div>
                    </div>
                    <div className="con-feature">
                        <div className="con-feature-icon">🛍️</div>
                        <div className="con-feature-title">Artist Alley</div>
                        <div style={{fontSize: '12px', color: '#9a9a9a'}}>画师摊位</div>
                    </div>
                    <div className="con-feature">
                        <div className="con-feature-icon">🎮</div>
                        <div className="con-feature-title">Gaming Zone</div>
                        <div style={{fontSize: '12px', color: '#9a9a9a'}}>游戏区</div>
                    </div>
                    <div className="con-feature">
                        <div className="con-feature-icon">👘</div>
                        <div className="con-feature-title">Cosplay Contest</div>
                        <div style={{fontSize: '12px', color: '#9a9a9a'}}>Cosplay大赛</div>
                    </div>
                </div>
                <div className="hero-buttons" style={{marginTop: '40px'}}>
                    <a href={LINKS.buyTicket} className="btn btn-primary">Get Tickets 购票</a>
                    <a href="#" className="btn btn-secondary">Learn More 了解更多</a>
                </div>
            </div>
        </div>
    </section>
)