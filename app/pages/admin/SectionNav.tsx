import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';

export interface NavSection {
    /** The DOM id of the element the section starts at. */
    id: string;
    label: string;
}

interface SectionNavProps {
    /** In page order. Fewer than two hides the navigator. */
    sections: NavSection[];
}

/** How far below the viewport top content stops being covered by the fixed admin nav. */
const topInset = () => (document.querySelector('.profile-nav')?.getBoundingClientRect().bottom ?? 0) + 16;

/**
 * A floating previous / next / jump-to control for admin tabs that stack several
 * long sections. The section under the top nav is the current one, so the
 * buttons always step relative to what the admin is looking at.
 *
 * Render it after the sections: it leaves a spacer in the flow so the last
 * section's buttons can scroll clear of it.
 */
export const SectionNav = ({sections}: SectionNavProps) => {
    const {isEnglish} = useLanguage();
    const [current, setCurrent] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const containerRef = useRef<HTMLElement>(null);
    /**
     * The section last jumped to, held until the admin scrolls away from where the
     * jump landed. Without it a short section near the bottom of the page — one the
     * page cannot scroll up to the top — would read as its neighbour right after
     * being picked. `settledY` stays null while the smooth scroll is still moving.
     */
    const pin = useRef<{index: number; settledY: number | null} | null>(null);
    const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const settle = useCallback(() => {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
            if (pin.current) pin.current.settledY = window.scrollY;
        }, 150);
    }, []);

    // Ids can't contain whitespace, so this is a stable key for the effect below
    // even though callers build a fresh `sections` array every render.
    const idKey = sections.map(s => s.id).join(' ');

    useEffect(() => {
        const ids = idKey.split(' ');
        if (ids.length < 2) return;
        let frame = 0;

        const measure = () => {
            frame = 0;
            const pinned = pin.current;
            if (pinned) {
                if (pinned.settledY === null) {
                    settle();
                    return;
                }
                if (Math.abs(window.scrollY - pinned.settledY) <= 4) return;
                pin.current = null;
            }

            const line = topInset() + 32;
            let index = 0;
            ids.forEach((id, i) => {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= line) index = i;
            });
            // Scrolled to the very end: the last section may be too short to ever
            // reach the line, but it is plainly the one on screen.
            const {scrollHeight} = document.documentElement;
            if (window.scrollY > 0 && window.innerHeight + window.scrollY >= scrollHeight - 2) {
                index = ids.length - 1;
            }
            setCurrent(index);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };

        measure();
        window.addEventListener('scroll', schedule, {passive: true});
        window.addEventListener('resize', schedule);
        // Sections grow and shrink as rows are added or lists load, without a scroll.
        const observer = new ResizeObserver(schedule);
        observer.observe(document.body);
        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [idKey, settle]);

    useEffect(() => () => {
        if (settleTimer.current) clearTimeout(settleTimer.current);
    }, []);

    // While open: close on outside click / Escape.
    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    if (sections.length < 2) return null;

    // `current` can briefly outlive a section that just dropped out of the list.
    const index = Math.min(current, sections.length - 1);

    const jump = (target: number) => {
        const el = sections[target] && document.getElementById(sections[target].id);
        if (!el) return;
        setMenuOpen(false);
        pin.current = {index: target, settledY: null};
        setCurrent(target);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - topInset(),
            behavior: reduceMotion ? 'auto' : 'smooth',
        });
        settle();
    };

    return (
        <>
            <div className="admin-secnav-spacer" aria-hidden="true"/>
            <nav
                ref={containerRef}
                className="admin-secnav"
                aria-label={isEnglish ? 'Sections' : '板块导航'}
            >
                {menuOpen && (
                    <ul className="admin-secnav-menu">
                        {sections.map((section, i) => (
                            <li key={section.id}>
                                <button
                                    type="button"
                                    className="admin-secnav-item"
                                    aria-current={i === index ? 'true' : undefined}
                                    onClick={() => jump(i)}
                                >
                                    <span className="admin-secnav-item-num">{i + 1}</span>
                                    {section.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <button
                    type="button"
                    className="admin-secnav-step"
                    onClick={() => jump(index - 1)}
                    disabled={index === 0}
                    aria-label={isEnglish ? 'Previous section' : '上一个板块'}
                    title={isEnglish ? 'Previous section' : '上一个板块'}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <polyline points="10,3 5,8 10,13"/>
                    </svg>
                </button>

                <button
                    type="button"
                    className="admin-secnav-current"
                    onClick={() => setMenuOpen(v => !v)}
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                    title={isEnglish ? 'Jump to a section' : '跳转到板块'}
                >
                    <span className="admin-secnav-label">{sections[index].label}</span>
                    <span className="admin-secnav-count">{index + 1} / {sections.length}</span>
                    <span className={`admin-secnav-caret${menuOpen ? ' admin-secnav-caret-open' : ''}`}>▴</span>
                </button>

                <button
                    type="button"
                    className="admin-secnav-step"
                    onClick={() => jump(index + 1)}
                    disabled={index === sections.length - 1}
                    aria-label={isEnglish ? 'Next section' : '下一个板块'}
                    title={isEnglish ? 'Next section' : '下一个板块'}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <polyline points="6,3 11,8 6,13"/>
                    </svg>
                </button>
            </nav>
        </>
    );
};
