import { useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ConContent } from '~/lib/conContent';
import { byHallOrder, HALL_ROWS, HALL_TABLES, type HallRow, rowOf } from '~/pages/con/hall';
import { HallMap } from '~/pages/con/HallMap';
import {
    HiddenSectionNote,
    LocalizedField,
    type SectionProps,
    SectionShell,
    useSectionEditor,
} from './conContentShared';

type VendorDraft = ConContent['vendors']['tables'][number];

export const VendorsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('vendors', content.vendors, loading, showToast);
    const {draft, setDraft} = editor;
    const [openRows, setOpenRows] = useState<ReadonlySet<HallRow>>(new Set());
    const [current, setCurrent] = useState<string | null>(null);
    const nameInputs = useRef(new Map<string, HTMLInputElement>());

    const byTable = useMemo(() => new Map(draft.tables.map(vendor => [vendor.table, vendor])), [draft.tables]);

    /**
     * The draft lists only occupied tables, in plan order, as the server stores
     * them, so filling and clearing a table is no change. A table with only a
     * link is kept, and Save asks for a name.
     */
    const setTable = (table: string, patch: Partial<Pick<VendorDraft, 'name' | 'link'>>) =>
        setDraft(prev => {
            const was = prev.tables.find(vendor => vendor.table === table);
            const name = patch.name ?? was?.name ?? '';
            const link = patch.link ?? was?.link ?? '';
            const rest = prev.tables.filter(vendor => vendor.table !== table);
            if (!name && !link) return {...prev, tables: rest};
            const next: VendorDraft = link ? {table, name, link} : {table, name};
            return {...prev, tables: [...rest, next].sort((a, b) => byHallOrder(a.table, b.table))};
        });

    const setRowOpen = (row: HallRow, open: boolean) =>
        setOpenRows(prev => {
            if (prev.has(row) === open) return prev;
            const next = new Set(prev);
            if (open) next.add(row);
            else next.delete(row);
            return next;
        });

    /** From the plan: open the table's row and put the cursor in its name. */
    const jumpTo = (table: string) => {
        setRowOpen(rowOf(table), true);
        setCurrent(table);
        // After the row has rendered open — a closed <details> hides its inputs.
        requestAnimationFrame(() => {
            const input = nameInputs.current.get(table);
            input?.focus({preventScroll: true});
            input?.scrollIntoView({block: 'center', behavior: 'smooth'});
        });
    };

    return (
        <SectionShell
            section="vendors"
            helper={{
                en: 'Who is at each table on the main hall floor plan, and the “want a table?” callout under it. Type a name to put a vendor at a table, or clear it to leave the table open. Click a table on the plan to jump to it. The tables themselves are fixed to HUB’s layout.',
                zh: '主会场平面图上各桌的摊主，以及下方「想要摊位？」的提示区块。输入名称即可将摊主安排到该桌，清空则该桌空置。点击平面图上的桌位可直接跳转。桌位布局按 HUB 场地固定。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <HiddenSectionNote content={content} section="vendors"/>

            <div className="admin-con-card">
                <div className="admin-con-card-head">
                    <span className="admin-con-card-title">
                        {isEnglish
                            ? `${draft.tables.length} of ${HALL_TABLES.length} tables taken`
                            : `已安排 ${draft.tables.length} / ${HALL_TABLES.length} 个桌位`}
                    </span>
                </div>

                <HallMap
                    vendors={byTable}
                    selected={current}
                    onSelect={jumpTo}
                    pickOpen
                    label={isEnglish ? 'Main hall floor plan' : '主会场平面图'}
                />
            </div>

            <div className="admin-con-list admin-mt-12">
                {HALL_ROWS.map(({letter}) => {
                    const tables = HALL_TABLES.filter(table => rowOf(table) === letter);
                    const taken = tables.filter(table => byTable.has(table)).length;
                    return (
                        <details
                            key={letter}
                            className="admin-con-card admin-con-vendor-row"
                            open={openRows.has(letter)}
                            onToggle={e => setRowOpen(letter, e.currentTarget.open)}
                        >
                            <summary className="admin-con-card-title">
                                {isEnglish ? `Row ${letter}` : `${letter} 排`}
                                <span className="admin-con-dirty">
                                    {isEnglish ? `${taken} of ${tables.length} taken` : `已安排 ${taken} / ${tables.length}`}
                                </span>
                            </summary>

                            <div className="admin-con-vendor-tables">
                                {tables.map(table => {
                                    const vendor = byTable.get(table);
                                    return (
                                        <div key={table} className="admin-con-vendor-table">
                                            <span className="sbc-table-code">{table}</span>
                                            <input
                                                ref={el => {
                                                    if (el) nameInputs.current.set(table, el);
                                                    else nameInputs.current.delete(table);
                                                }}
                                                className="admin-input admin-input--sm"
                                                value={vendor?.name ?? ''}
                                                onChange={e => !readOnly && setTable(table, {name: e.target.value})}
                                                onFocus={() => setCurrent(table)}
                                                readOnly={readOnly}
                                                placeholder={isEnglish ? 'Open table' : '空桌'}
                                                aria-label={isEnglish ? `Table ${table} vendor` : `${table} 桌摊主`}
                                            />
                                            <input
                                                className="admin-input admin-input--sm"
                                                type="url"
                                                value={vendor?.link ?? ''}
                                                onChange={e => !readOnly && setTable(table, {link: e.target.value})}
                                                onFocus={() => setCurrent(table)}
                                                readOnly={readOnly}
                                                placeholder={isEnglish ? 'Link (optional)' : '链接（可选）'}
                                                aria-label={isEnglish ? `Table ${table} link` : `${table} 桌链接`}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </details>
                    );
                })}
            </div>

            <div className="admin-con-card admin-mt-12">
                <div className="admin-con-card-head">
                    <span className="admin-con-card-title">
                        {isEnglish ? 'Tabling callout' : '摊位招募区块'}
                    </span>
                </div>
                <label className="admin-checkbox-label">
                    <input
                        type="checkbox"
                        checked={draft.cta.visible}
                        onChange={e => !readOnly
                            && setDraft(prev => ({...prev, cta: {...prev.cta, visible: e.target.checked}}))}
                        disabled={readOnly}
                    />
                    <span>{isEnglish ? 'Show the callout on /con' : '在 /con 显示该区块'}</span>
                </label>
                <div className="admin-form-grid admin-mt-12">
                    <LocalizedField
                        label={{en: 'Heading', zh: '标题'}}
                        value={draft.cta.heading}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, heading: next}}))}
                        readOnly={readOnly}
                    />
                    <LocalizedField
                        label={{en: 'Body', zh: '正文'}}
                        value={draft.cta.body}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, body: next}}))}
                        readOnly={readOnly}
                        multiline
                    />
                    <LocalizedField
                        label={{en: 'Button label', zh: '按钮文字'}}
                        value={draft.cta.label}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, label: next}}))}
                        readOnly={readOnly}
                    />
                </div>
            </div>
        </SectionShell>
    );
};
