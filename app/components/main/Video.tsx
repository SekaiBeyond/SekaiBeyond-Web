import React from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { LINKS } from "~/constants";

export const Video = () => {
    const {isEnglish} = useLanguage();
    const videoSrc = {
        aid: "116106639514970", // 替换为实际的AV号
        bvid: "BV1GsfjB7E6J", // 替换为实际的BV号
        cid: "36189832448", // 替换为实际的CID号
        p: "1", // 替换为实际的P号，如果有多个分P的话
    }

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
                        src={`//player.bilibili.com/player.html?isOutside=true&aid=${videoSrc.aid}&bvid=${videoSrc.bvid}&cid=${videoSrc.cid}&p=${videoSrc.p}&autoplay=0`}
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