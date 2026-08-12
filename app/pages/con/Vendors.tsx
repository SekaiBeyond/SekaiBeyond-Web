import { LINKS } from '~/constants';
import { useConContent } from '~/lib/conContent';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Vendors = () => {
    const t = useT();
    const {list, cta} = useConContent().content.vendors;

    return (
        <section id="vendors" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Artist alley', zh: '创作者市集'}}
                title={{en: 'Makers & Tables', zh: '摊主与摊位'}}
                subtitle={{
                    en: 'Prints, charms, plushes, and zines — bring cash, most tables also take cards.',
                    zh: '海报、挂件、毛绒与刊物——建议带现金，多数摊位也支持刷卡。',
                }}
            />

            <div className="sbc-vendor-grid">
                {/* Keyed by position: placeholder table names repeat ("Table A1 — TBA"). */}
                {list.map((vendor, i) => {
                    const body = (
                        <>
                            <h3 className="sbc-vendor-name">{vendor.name}</h3>
                            <p className="sbc-vendor-kind">{t(vendor.kind)}</p>
                            {vendor.handle && <p className="sbc-vendor-handle">{vendor.handle}</p>}
                        </>
                    );

                    return vendor.link ? (
                        <a
                            key={i}
                            className="sbc-vendor-card sbc-vendor-card--link"
                            href={vendor.link}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {body}
                        </a>
                    ) : (
                        <article key={i} className="sbc-vendor-card">{body}</article>
                    );
                })}
            </div>

            <div className="sbc-callout">
                <div>
                    <h3 className="sbc-callout-title">{t(cta.heading)}</h3>
                    <p className="sbc-callout-body">{t(cta.body)}</p>
                </div>
                <a className="btn btn-secondary" href={LINKS.email}>
                    <span>{t(cta.label)}</span>
                    <span aria-hidden="true">✉️</span>
                </a>
            </div>
        </section>
    );
};
