import { useState } from "react";
import { Link } from "react-router";
import { useLanguage } from "~/components/LanguageContextProvider";
import { EventImageModal } from "~/components/EventImageModal";
import { useSiteConfig } from "~/lib/siteConfig";
import { useConContent } from "~/lib/conContent";

export const SekaiBeyondCon = () => {
    const {isEnglish} = useLanguage();
    const {config, loading} = useSiteConfig();
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const {content: conContent, loading: conLoading} = useConContent();

    // Hide the entire section while loading or when there's no edition configured.
    if (loading || conLoading || !config.conEdition) {
        return null;
    }

    const edition = config.conEdition;

    return (
        <section id="con" className="section">
            <div className="section-header">
                <h2 className="section-title">Sekai Beyond Con</h2>
                <p className="section-subtitle">
                    {isEnglish
                        ? "Our annual convention celebrating anime, comics, games, and novels"
                        : "我们一年一度的动漫、漫画、游戏与小说盛会"}
                </p>
            </div>

            <div className="con-editions">
                <div key={edition.year} className="convention-banner">
                    <div className="con-decorations">
                        <span className="con-deco">🌸</span>
                        <span className="con-deco">🎨</span>
                        <span className="con-deco">🎤</span>
                        <span className="con-deco">🎸</span>
                    </div>

                    <div className="con-banner-inner">
                        <span className="convention-label">
                            {new Date(edition.date).getUTCFullYear()} {isEnglish ? "Edition" : "年度"}
                        </span>

                        <h3 className="convention-title">
                            {isEnglish ? "Sekai Beyond Con" : "彼世界动漫游戏展"}
                        </h3>

                        <p className="convention-location">
                            <span>📅 </span>
                            {new Date(edition.date).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                timeZone: 'UTC'
                            })}
                            <span> • 📍 </span>
                            {edition.locationCn && !isEnglish ? edition.locationCn : edition.location}
                        </p>

                        <div className="convention-poster">
                            <button
                                type="button"
                                className="event-image-btn"
                                onClick={() => setSelectedImage(edition.image)}
                                aria-label={isEnglish ? `View Sekai Beyond Con ${edition.year} poster` : `查看${edition.year}年彼世界漫展海报`}
                            >
                                <img
                                    src={edition.image}
                                    alt={isEnglish ? `Sekai Beyond Con ${edition.year}` : `彼世界漫展 ${edition.year}`}
                                />
                            </button>
                        </div>

                        <div className="convention-features">
                            {edition.highlights.map((highlight, index) => (
                                <div key={index} className="feature-item">
                                    <span className="feature-icon">{highlight.icon}</span>
                                    <span className="feature-text">
                                        {isEnglish ? highlight.labelEn : highlight.labelCn}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <p className="con-description">
                            {isEnglish ? edition.description : edition.descriptionCn}
                        </p>

                        {conContent.settings.published && (
                            <Link className="btn btn-primary con-page-link" to="/con">
                                <span>{isEnglish ? "Explore the Con" : "了解漫展详情"}</span>
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            {selectedImage && (
                <EventImageModal
                    imageUrl={selectedImage}
                    onClose={() => setSelectedImage(null)}
                    altText={isEnglish ? "Convention poster" : "漫展海报"}
                />
            )}
        </section>
    );

};
