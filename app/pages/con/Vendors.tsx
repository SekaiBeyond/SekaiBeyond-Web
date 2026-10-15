import { useMemo, useRef, useState } from 'react';
import { LuArrowUpRight, LuMail, LuSearch, LuX } from 'react-icons/lu';
import { useConContent } from '~/lib/conContent';
import { useSiteConfig } from '~/lib/siteConfig';
import { HALL_ROWS, type HallRow, rowOf } from '~/pages/con/hall';
import { HallMap } from '~/pages/con/HallMap';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

/** "a 1", "A-1" and "a1" all read as table A1. */
const asTableQuery = (query: string) => query.replace(/[\s-]/g, '').toUpperCase();

export const Vendors = () => {
    const t = useT();
    const {tables, cta} = useConContent().content.vendors;
    const {config} = useSiteConfig();
    const sectionRef = useRef<HTMLElement>(null);

    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);
    const [row, setRow] = useState<HallRow | null>(null);

    const byTable = useMemo(() => new Map(tables.map(vendor => [vendor.table, vendor])), [tables]);

    const needle = query.trim().toLowerCase();
    /** Null while nothing is typed, so "no search" and "a search that found nothing" stay apart. */
    const found = useMemo(() => {
        if (!needle) return null;
        const code = asTableQuery(needle);
        return tables.filter(vendor =>
            vendor.table.startsWith(code) || vendor.name.toLowerCase().includes(needle));
    }, [tables, needle]);
    const matches = useMemo(() => found && new Set(found.map(vendor => vendor.table)), [found]);

    // Derived, so a refresh that drops the selected table drops the selection with it.
    const pinned = selected !== null && byTable.has(selected) ? selected : null;
    // A search naming a table, or down to one vendor, answers itself. "B1" also
    // matches B10–B15, but B1 was asked.
    const exact = needle && byTable.has(asTableQuery(needle)) ? asTableQuery(needle) : null;
    const lit = pinned ?? exact ?? (found?.length === 1 ? found[0].table : null);
    // A hover previews in the panel; it isn't a selection.
    const shownTable = hovered ?? lit;
    const shown = shownTable ? byTable.get(shownTable) : undefined;

    const groups = HALL_ROWS
        .map(({letter}) => ({letter, vendors: (found ?? tables).filter(vendor => rowOf(vendor.table) === letter)}))
        .filter(group => group.vendors.length > 0);

    // The row a narrow screen lists, else the first with anyone in it.
    const activeRow = groups.some(group => group.letter === row) ? row : groups[0]?.letter ?? null;

    const pickOnMap = (table: string) => {
        setSelected(prev => (prev === table ? null : table));
        setRow(rowOf(table));
    };

    const pickInList = (table: string) => {
        setSelected(table);
        // Only if it's off screen: on a phone the plan is a screen above the list.
        const el = sectionRef.current?.querySelector(`.sbc-hall [data-table="${table}"]`);
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el?.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: still ? 'auto' : 'smooth'});
    };

    const rowName = (letter: HallRow) => t({en: `Row ${letter}`, zh: `${letter} 排`});
    const searchLabel = t({en: 'Find a vendor or table', zh: '搜索摊主或桌号'});

    return (
        <section id="vendors" className="sbc-section" ref={sectionRef}>
            <SectionHeader
                title={{en: 'Artist Alley', zh: '创作者市集'}}
                subtitle={{
                    en: 'Prints, charms, plushes, and zines — bring cash, most tables also take cards.',
                    zh: '海报、挂件、毛绒与刊物——建议带现金，多数摊位也支持刷卡。',
                }}
            />

            <div className="sbc-hall-card">
                <div className="sbc-hall-toolbar">
                    <div>
                        <h3 className="sbc-hall-title">{t({en: 'Main Hall', zh: '主会场'})}</h3>
                        <p className="sbc-hall-count">
                            {tables.length > 0
                                ? t({en: `${tables.length} tables`, zh: `${tables.length} 个摊位`})
                                : t({en: 'Tables to be announced', zh: '摊位待公布'})}
                        </p>
                        <p className="sbc-hall-note">
                            {t({
                                en: 'Table assignments and the layout are subject to change.',
                                zh: '摊位安排与场地布局可能会有变动。',
                            })}
                        </p>
                    </div>

                    {tables.length > 0 && (
                        <label className="sbc-vendor-search">
                            <LuSearch aria-hidden="true"/>
                            <input
                                type="search"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={searchLabel}
                                aria-label={searchLabel}
                            />
                        </label>
                    )}
                </div>

                <HallMap
                    vendors={byTable}
                    selected={lit}
                    onSelect={pickOnMap}
                    onHover={setHovered}
                    matches={matches}
                    label={t({en: 'Main hall floor plan', zh: '主会场平面图'})}
                />

                <div className="sbc-hall-spotlight" aria-live="polite">
                    {shown ? (
                        <>
                            <span className="sbc-table-code sbc-table-code--lg">{shown.table}</span>
                            <div className="sbc-hall-spotlight-text">
                                <p className="sbc-hall-spotlight-name">{shown.name}</p>
                                <p className="sbc-hall-spotlight-where">
                                    {rowName(rowOf(shown.table))} · {t({en: 'Main Hall', zh: '主会场'})}
                                </p>
                            </div>
                            {shown.link && (
                                <a
                                    className="sbc-hall-spotlight-link"
                                    href={shown.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t({en: 'See their work', zh: '查看作品'})}
                                    <LuArrowUpRight aria-hidden="true"/>
                                </a>
                            )}
                            {pinned === shown.table && (
                                <button
                                    type="button"
                                    className="sbc-hall-spotlight-clear"
                                    onClick={() => setSelected(null)}
                                    aria-label={t({en: 'Clear selection', zh: '取消选择'})}
                                >
                                    <LuX aria-hidden="true"/>
                                </button>
                            )}
                        </>
                    ) : (
                        <p className="sbc-hall-spotlight-hint">
                            {tables.length > 0
                                ? t({
                                    en: 'Tap a table to see who is there, or search for a vendor by name.',
                                    zh: '点击桌位查看摊主，或按名称搜索。',
                                })
                                : t({
                                    en: 'Who is at each table will be posted here closer to the con.',
                                    zh: '各桌摊主将在临近漫展时公布于此。',
                                })}
                        </p>
                    )}
                </div>
            </div>

            {tables.length > 0 && (
                <div className="sbc-vendor-directory">
                    {/* Narrow screens only, where four rows of fifteen won't fit side by
                        side. A search lists every row it matched instead. */}
                    {!found && groups.length > 1 && (
                        <div
                            className="sbc-vendor-row-filter"
                            role="group"
                            aria-label={t({en: 'Choose a row', zh: '选择排'})}
                        >
                            {groups.map(group => (
                                <button
                                    key={group.letter}
                                    type="button"
                                    className="sbc-filter-chip"
                                    aria-pressed={activeRow === group.letter}
                                    onClick={() => setRow(group.letter)}
                                >
                                    {rowName(group.letter)}
                                </button>
                            ))}
                        </div>
                    )}

                    {found?.length === 0 && (
                        <p className="sbc-vendor-empty">
                            {t({en: `No vendor matches “${query.trim()}”.`, zh: `没有与「${query.trim()}」匹配的摊主。`})}
                        </p>
                    )}

                    <div className="sbc-vendor-rows">
                        {groups.map(group => (
                            <div
                                key={group.letter}
                                className="sbc-vendor-row"
                                data-inactive={!found && group.letter !== activeRow ? '' : undefined}
                            >
                                <h3 className="sbc-vendor-row-title">
                                    <span>{rowName(group.letter)}</span>
                                    <span className="sbc-vendor-row-count">{group.vendors.length}</span>
                                </h3>
                                <ul className="sbc-vendor-list">
                                    {group.vendors.map(vendor => (
                                        <li key={vendor.table} className="sbc-vendor-entry">
                                            <button
                                                type="button"
                                                className="sbc-vendor-pick"
                                                aria-pressed={pinned === vendor.table}
                                                onClick={() => pickInList(vendor.table)}
                                            >
                                                <span className="sbc-table-code">{vendor.table}</span>
                                                <span className="sbc-vendor-name">{vendor.name}</span>
                                            </button>
                                            {vendor.link && (
                                                <a
                                                    className="sbc-vendor-link"
                                                    href={vendor.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={t({
                                                        en: `${vendor.name}’s work (opens a new tab)`,
                                                        zh: `${vendor.name} 的作品（在新标签页打开）`,
                                                    })}
                                                >
                                                    <LuArrowUpRight aria-hidden="true"/>
                                                </a>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {cta.visible && (
                <div className="sbc-callout">
                    <div>
                        <h3 className="sbc-callout-title">{t(cta.heading)}</h3>
                        <p className="sbc-callout-body">{t(cta.body)}</p>
                    </div>
                    {config.contactEmail && (
                        <a className="btn btn-secondary" href={`mailto:${config.contactEmail}`}>
                            <span>{t(cta.label)}</span>
                            <LuMail aria-hidden="true"/>
                        </a>
                    )}
                </div>
            )}
        </section>
    );
};
