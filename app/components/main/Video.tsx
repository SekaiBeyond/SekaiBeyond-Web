import { useLanguage } from "~/components/LanguageContextProvider";
import { BILIBILI_VIDEO, LINKS } from "~/constants";
import { useSiteConfig } from "~/lib/siteConfig";

export const Video = () => {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();

    const bvid = config.bilibiliVideoBvid || BILIBILI_VIDEO.bvid;
    const bilibiliWatchUrl = `https://www.bilibili.com/video/${bvid}`;
    const coverUrl = config.bilibiliVideoCoverUrl;

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
                <div className="video-wrapper video-wrapper--desktop">
                    <iframe
                        src={`https://player.bilibili.com/player.html?isOutside=true&bvid=${bvid}&autoplay=0`}
                        allowFullScreen={true}
                        title={isEnglish ? "Sekai Beyond Video" : "彼世界视频"}
                        autoFocus={false}
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                    />
                </div>

                <a
                    className="video-wrapper video-wrapper--mobile"
                    href={bilibiliWatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={isEnglish ? "Watch on Bilibili" : "在B站观看"}
                >
                    <div
                        className="video-mobile-card"
                        style={coverUrl ? {background: `linear-gradient(135deg, rgba(26, 26, 46, 0.72), rgba(22, 33, 62, 0.72)), url('${coverUrl}') center/cover no-repeat`} : undefined}
                    >
                        <div className="video-mobile-play" aria-hidden="true">▶</div>
                        <div className="video-mobile-text">
                            <div className="video-mobile-title">
                                {isEnglish ? "Watch on Bilibili" : "在B站观看"}
                            </div>
                            <div className="video-mobile-subtitle">
                                {isEnglish
                                    ? "Opens in the Bilibili app or website"
                                    : "在 B 站 App 或网页中打开"}
                            </div>
                        </div>
                    </div>
                </a>

                <div className="video-info">
                    <div className="video-badge">
                        <span className="video-badge-icon">🎬</span>
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