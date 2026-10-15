import { useEffect, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuClock, LuMapPin, LuX } from 'react-icons/lu';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import { useModalEffects } from '~/lib/useModalEffects';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';
import { formatClockTime } from '~/pages/con/utils';

interface Poster {
    src: string;
    caption: string;
}

interface PosterViewerProps {
    posters: Poster[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
}

/**
 * One poster full size with the rest either side; the thumbnails are for
 * picking, this is for reading.
 */
const PosterViewer = ({posters, index, onIndex, onClose}: PosterViewerProps) => {
    const t = useT();
    const ref = useRef<HTMLDivElement>(null);
    useModalEffects(true, ref, onClose);

    const count = posters.length;
    const step = (delta: number) => onIndex((index + delta + count) % count);

    // `step` is rebuilt from these each render, so they are what the listener needs.
    useEffect(() => {
        if (count < 2) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') step(-1);
            if (event.key === 'ArrowRight') step(1);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [index, count, onIndex]);

    const poster = posters[index];

    return (
        <div
            ref={ref}
            className="sbc-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={poster.caption}
            onClick={onClose}
        >
            <button
                type="button"
                className="sbc-viewer-btn sbc-viewer-close"
                onClick={onClose}
                aria-label={t({en: 'Close', zh: '关闭'})}
            >
                <LuX/>
            </button>

            <figure className="sbc-viewer-figure" onClick={event => event.stopPropagation()}>
                <img src={poster.src} alt={poster.caption}/>
                <figcaption>
                    {poster.caption}
                    {count > 1 && <span className="sbc-viewer-count">{index + 1} / {count}</span>}
                </figcaption>
            </figure>

            {count > 1 && (
                <>
                    <button
                        type="button"
                        className="sbc-viewer-btn sbc-viewer-nav sbc-viewer-nav--prev"
                        onClick={event => {
                            event.stopPropagation();
                            step(-1);
                        }}
                        aria-label={t({en: 'Previous poster', zh: '上一张海报'})}
                    >
                        <LuChevronLeft/>
                    </button>
                    <button
                        type="button"
                        className="sbc-viewer-btn sbc-viewer-nav sbc-viewer-nav--next"
                        onClick={event => {
                            event.stopPropagation();
                            step(1);
                        }}
                        aria-label={t({en: 'Next poster', zh: '下一张海报'})}
                    >
                        <LuChevronRight/>
                    </button>
                </>
            )}
        </div>
    );
};

/**
 * The maid café: its poster beside the theme, room and hours, then each maid's.
 * Each part appears once filled in.
 */
export const MaidCafe = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {cafe} = useConContent().content;
    const [open, setOpen] = useState<number | null>(null);

    const theme = t(cafe.theme);
    const location = t(cafe.location);
    const intro = t(cafe.intro);
    const hours = cafe.start && cafe.end
        ? `${formatClockTime(cafe.start, currentLanguage)} – ${formatClockTime(cafe.end, currentLanguage)}`
        : '';
    const hasDetails = !!(theme || location || hours || intro);

    // Every poster in page order, so the viewer steps through them as they are laid out.
    const posters: Poster[] = [
        ...(cafe.poster ? [{src: cafe.poster, caption: theme || t({en: 'Maid Café', zh: '女仆咖啡'})}] : []),
        ...cafe.maids.flatMap(maid => (maid.poster ? [{src: maid.poster, caption: maid.name}] : [])),
    ];
    const openPoster = (src: string) => setOpen(posters.findIndex(poster => poster.src === src));

    return (
        <section id="cafe" className="sbc-section">
            <SectionHeader
                title={{en: 'Maid Café', zh: '女仆咖啡'}}
                subtitle={{
                    en: 'Drinks, sweets, and a warm welcome from the maids.',
                    zh: '饮品、甜点，还有女仆们的热情招待。',
                }}
            />

            {(cafe.poster || hasDetails) && (
                <div className={`sbc-cafe${cafe.poster ? '' : ' sbc-cafe--text-only'}`}>
                    {cafe.poster && (
                        <button
                            type="button"
                            className="sbc-poster-btn sbc-cafe-poster"
                            onClick={() => openPoster(cafe.poster)}
                            aria-label={t({en: 'View the café poster', zh: '查看咖啡厅海报'})}
                        >
                            <img className="sbc-poster" src={cafe.poster} alt=""/>
                        </button>
                    )}

                    {hasDetails && (
                        <div className="sbc-cafe-details">
                            {theme && (
                                <>
                                    <p className="sbc-cafe-eyebrow">{t({en: "This year's theme", zh: '本届主题'})}</p>
                                    <h3 className="sbc-cafe-theme">{theme}</h3>
                                </>
                            )}

                            {(location || hours) && (
                                <ul className="sbc-cafe-facts">
                                    {location && (
                                        <li>
                                            <LuMapPin aria-hidden="true"/>
                                            {location}
                                        </li>
                                    )}
                                    {hours && (
                                        <li>
                                            <LuClock aria-hidden="true"/>
                                            {hours}
                                        </li>
                                    )}
                                </ul>
                            )}

                            {intro && <p className="sbc-cafe-intro">{intro}</p>}
                        </div>
                    )}
                </div>
            )}

            {cafe.maids.length > 0 && (
                <div className="sbc-maids">
                    <h3 className="sbc-maids-title">{t({en: 'Meet the maids', zh: '女仆阵容'})}</h3>

                    <ul className="sbc-maid-grid">
                        {/* Keyed by position: two maids may share a name. */}
                        {cafe.maids.map((maid, i) => (
                            <li key={i}>
                                {maid.poster ? (
                                    <button
                                        type="button"
                                        className="sbc-poster-btn sbc-maid-card"
                                        onClick={() => openPoster(maid.poster)}
                                        aria-label={t({
                                            en: `View ${maid.name}'s poster`,
                                            zh: `查看 ${maid.name} 的海报`,
                                        })}
                                    >
                                        <img className="sbc-poster" src={maid.poster} alt="" loading="lazy"/>
                                        <span className="sbc-maid-name">{maid.name}</span>
                                    </button>
                                ) : (
                                    <div className="sbc-maid-card">
                                        <div className="sbc-poster sbc-poster--placeholder" aria-hidden="true">
                                            {maid.name.slice(0, 1)}
                                        </div>
                                        <span className="sbc-maid-name">{maid.name}</span>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {open !== null && posters[open] && (
                <PosterViewer
                    posters={posters}
                    index={open}
                    onIndex={setOpen}
                    onClose={() => setOpen(null)}
                />
            )}
        </section>
    );
};
