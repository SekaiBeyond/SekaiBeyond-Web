import React from "react";
import { useLanguage } from "../LanguageContextProvider";
import { LINKS } from "../Constants";

export const Video = () => {
    const {isEnglish} = useLanguage();

    return (
        <section id="video" className="video-section section">
            <div className="section-header">
                <h2 className="section-title">
                    {isEnglish ? "See Us in Action" : "精彩时刻"}
                </h2>
                <p className="section-subtitle">
                    {isEnglish
                        ? "Experience the energy and creativity of our community"
                        : "体验我们社区的活力与创造力"}
                </p>
            </div>

            <div className="video-content">
                <div className="video-wrapper">
                    <iframe
                        src="//player.bilibili.com/player.html?isOutside=true&aid=115586075991796&bvid=BV1AhyMBgEfk&cid=34161035657&p=1&autoplay=0"
                        allowFullScreen={true}
                        title={isEnglish ? "Sekai Beyond Video" : "彼世界视频"}
                        autoFocus={false}
                    />
                </div>

                <div className="video-info">
                    <div className="video-badge">
                        <span className="badge-icon">🎬</span>
                        <span>{isEnglish ? "Featured Video" : "精选视频"}</span>
                    </div>
                    <p className="video-caption">
                        {isEnglish
                            ? "Watch highlights from our events, performances, and community gatherings!"
                            : "观看我们活动、表演和社区聚会的精彩集锦！"}
                    </p>
                    <a
                        href={LINKS.bilibili}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="video-cta"
                    >
                        <span>{isEnglish ? "More Videos on Bilibili" : "在B站观看更多"}</span>
                        <span className="cta-arrow">→</span>
                    </a>
                </div>
            </div>
        </section>
    );
};