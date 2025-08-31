import React from "react";

export const About = () => (
    <section id="about" className="about-section section">
        <div className="section-header">
            <h2 className="section-title">About Sekai Beyond</h2>
            <h3 className="section-title-cn">关于彼世界动漫社</h3>
            <p className="section-subtitle">
                Bridging cultures through our shared love of ACG<br/>
                通过ACG文化连接不同世界
            </p>
        </div>
        <div className="about-content">
            <div className="about-text">
                <h3>Your ACG Home at UW 你在华大的ACG之家</h3>
                <p>
                    Founded by Chinese students passionate about anime and gaming culture, Sekai Beyond
                    has grown into UW's largest ACG community. We celebrate both Japanese anime culture
                    and the rising Chinese ACG scene, from donghua to mobile games.
                </p>
                <p style={{fontSize: '0.95em', color: '#8a8a8a'}}>
                    由热爱动漫游戏文化的中国留学生创立，世界之外已发展成为华大最大的ACG社团。
                    我们不仅推广日本动漫文化，也积极分享中国ACG文化，从国漫到手游，应有尽有。
                </p>
                <div className="about-features">
                    <div className="feature-item">
                        <span className="feature-icon">🎬</span>
                        <span className="feature-text">Weekly Anime 每周放映</span>
                    </div>
                    <div className="feature-item">
                        <span className="feature-icon">🎮</span>
                        <span className="feature-text">Gaming Nights 游戏之夜</span>
                    </div>
                    <div className="feature-item">
                        <span className="feature-icon">🎨</span>
                        <span className="feature-text">Art Workshop 绘画工坊</span>
                    </div>
                    <div className="feature-item">
                        <span className="feature-icon">🍱</span>
                        <span className="feature-text">Cultural Events 文化活动</span>
                    </div>
                </div>
            </div>
            <div className="about-image">
                <div className="culture-cards">
                    <div className="culture-card">
                        <div className="culture-icon">🏮</div>
                        <div className="culture-title">中国ACG</div>
                    </div>
                    <div className="culture-card">
                        <div className="culture-icon">🌸</div>
                        <div className="culture-title">日本アニメ</div>
                    </div>
                </div>
            </div>
        </div>
    </section>
)
