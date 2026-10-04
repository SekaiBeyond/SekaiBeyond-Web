import type { Localized } from '~/pages/con/i18n';
import { useT } from '~/pages/con/i18n';

interface SectionHeaderProps {
    title: Localized;
    subtitle?: Localized;
}

export const SectionHeader = ({title, subtitle}: SectionHeaderProps) => {
    const t = useT();

    return (
        <div className="sbc-section-header">
            <h2 className="sbc-section-title">{t(title)}</h2>
            {subtitle && <p className="sbc-section-subtitle">{t(subtitle)}</p>}
        </div>
    );
};
