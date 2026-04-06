import { useState } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { type ConEdition, SEKAI_BEYOND_CON } from "~/constants";
import { EventImageModal } from "~/components/EventImageModal";

export const SekaiBeyondCon = () => {
    const {isEnglish} = useLanguage();
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

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
                {SEKAI_BEYOND_CON.map((edition: ConEdition) => (
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

                            <div className="convention-poster" onClick={() => setSelectedImage(edition.image)}>
                                <img
                                    src={edition.image}
                                    alt={isEnglish ? `Sekai Beyond Con ${edition.year}` : `彼世界漫展 ${edition.year}`}
                                />
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
                        </div>
                    </div>
                ))}
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
