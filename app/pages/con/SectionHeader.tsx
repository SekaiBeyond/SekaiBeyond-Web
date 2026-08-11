import type { Localized } from '~/pages/con/i18n';
import { useT } from '~/pages/con/i18n';

interface SectionHeaderProps {
    eyebrow?: Localized;
    title: Localized;
    subtitle?: Localized;
}

export const SectionHeader = ({eyebrow, title, subtitle}: SectionHeaderProps) => {
    const t = useT();

    return (
        <div className="sbc-section-header">
            {eyebrow && <span className="sbc-section-eyebrow">{t(eyebrow)}</span>}
            <h2 className="sbc-section-title">{t(title)}</h2>
            {subtitle && <p className="sbc-section-subtitle">{t(subtitle)}</p>}
        </div>
    );
};
