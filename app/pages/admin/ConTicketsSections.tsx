import { useLanguage } from '~/components/LanguageContextProvider';
import type { ConContent, EarlyBird, InPersonSession } from '~/lib/conContent';
import { parseSiteTime } from '~/lib/siteTime';
import { useT } from '~/pages/con/i18n';
import { formatPrice, formatSessionDay, sessionBounds, ticketFeeFor } from '~/pages/con/utils';
import {
    AddButton,
    AmountField,
    BLANK,
    EmptyRow,
    LocalizedField,
    moveAt,
    newRowId,
    removeAt,
    replaceAt,
    RowActions,
    type SectionProps,
    SectionShell,
    useSectionEditor,
} from './conContentShared';

interface EarlyBirdFieldsProps {
    earlyBird: EarlyBird;
    onChange: (next: EarlyBird) => void;
    readOnly?: boolean;
}

const EarlyBirdFields = ({earlyBird, onChange, readOnly}: EarlyBirdFieldsProps) => {
    const {isEnglish} = useLanguage();
    const ended = earlyBird.endsAt !== '' && parseSiteTime(earlyBird.endsAt).getTime() <= Date.now();

    return (
        <>
            <AmountField
                label={{en: 'Early bird price', zh: '早鸟价格'}}
                value={earlyBird.price}
                onChange={next => onChange({...earlyBird, price: next})}
                readOnly={readOnly}
            />
            <label>
                <span>{isEnglish ? 'Early bird ends (Pacific)' : '早鸟截止时间（太平洋时间）'}</span>
                <input
                    className="admin-input"
                    type="datetime-local"
                    value={earlyBird.endsAt}
                    onChange={e => !readOnly && onChange({...earlyBird, endsAt: e.target.value})}
                    readOnly={readOnly}
                />
                <span className={`admin-helper-text admin-mt-4${ended ? ' admin-con-warning' : ''}`}>
                    {ended
                        ? (isEnglish
                            ? 'This time has passed — visitors see only the regular price.'
                            : '该时间已过，访客只会看到常规价格。')
                        : (isEnglish
                            ? 'Until then the card shows the early bird price, when it ends, and the regular price after. It switches over on its own.'
                            : '截止前，卡片会显示早鸟价、截止时间以及之后的常规价格，到时自动切换。')}
                </span>
            </label>
        </>
    );
};

export const TicketsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('tickets', content.tickets, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['tickets'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    return (
        <SectionShell
            section="tickets"
            helper={{
                en: 'Tiers appear left to right in this order. “Most popular” highlights one card — the page shows the flag on every tier you mark, so mark one.',
                zh: '票种按此顺序从左至右展示。「最受欢迎」会高亮显示对应卡片，建议只标记一个。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No ticket tiers yet.', zh: '暂无票种。'}}/>}

                {draft.map((tier, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {tier.name.en || (isEnglish ? `Tier ${index + 1}` : `票种 ${index + 1}`)}
                            </span>
                            <RowActions
                                index={index}
                                count={draft.length}
                                onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <LocalizedField
                                label={{en: 'Tier name', zh: '票种名称'}}
                                value={tier.name}
                                onChange={next => update(index, {...tier, name: next})}
                                readOnly={readOnly}
                            />
                            <AmountField
                                label={tier.earlyBird
                                    ? {en: 'Regular price', zh: '常规价格'}
                                    : {en: 'Price', zh: '价格'}}
                                value={tier.price}
                                onChange={next => update(index, {...tier, price: next})}
                                readOnly={readOnly}
                                helper={{en: '0 shows as “Free”.', zh: '填 0 时显示为「免费」。'}}
                            />

                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={!!tier.earlyBird}
                                    onChange={e => !readOnly && update(index, {
                                        ...tier,
                                        earlyBird: e.target.checked ? {price: 0, endsAt: ''} : undefined,
                                    })}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Offer an early bird price' : '提供早鸟价'}</span>
                            </label>

                            {tier.earlyBird && (
                                <EarlyBirdFields
                                    earlyBird={tier.earlyBird}
                                    onChange={next => update(index, {...tier, earlyBird: next})}
                                    readOnly={readOnly}
                                />
                            )}

                            <LocalizedField
                                label={{en: 'Note', zh: '说明'}}
                                value={tier.note}
                                onChange={next => update(index, {...tier, note: next})}
                                readOnly={readOnly}
                            />

                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={tier.featured === true}
                                    onChange={e => !readOnly && update(index, {...tier, featured: e.target.checked})}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Mark as most popular' : '标记为最受欢迎'}</span>
                            </label>
                        </div>

                        <div className="admin-con-list">
                            <span className="admin-con-card-title">{isEnglish ? 'Perks' : '权益'}</span>
                            {tier.perks.map((perk, perkIndex) => (
                                <div key={perkIndex} className="admin-con-item">
                                    <div className="admin-con-card-head">
                                        <span className="admin-con-card-title">
                                            {isEnglish ? `Perk ${perkIndex + 1}` : `权益 ${perkIndex + 1}`}
                                        </span>
                                        <RowActions
                                            index={perkIndex}
                                            count={tier.perks.length}
                                            onMove={delta => update(index, {
                                                ...tier,
                                                perks: moveAt(tier.perks, perkIndex, delta),
                                            })}
                                            onRemove={() => update(index, {
                                                ...tier,
                                                perks: removeAt(tier.perks, perkIndex),
                                            })}
                                            readOnly={readOnly}
                                        />
                                    </div>
                                    <div className="admin-form-grid">
                                        <LocalizedField
                                            label={{en: 'Perk', zh: '权益'}}
                                            value={perk}
                                            onChange={next => update(index, {
                                                ...tier,
                                                perks: replaceAt(tier.perks, perkIndex, next),
                                            })}
                                            readOnly={readOnly}
                                        />
                                    </div>
                                </div>
                            ))}
                            <AddButton
                                label={{en: 'perk', zh: '权益'}}
                                onClick={() => update(index, {...tier, perks: [...tier.perks, BLANK]})}
                                readOnly={readOnly}
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'tier', zh: '票种'}}
                    onClick={() => setDraft(prev => [...prev, {
                        id: newRowId('tier'),
                        name: BLANK,
                        price: 0,
                        note: BLANK,
                        perks: [],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

export const TicketFeeSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const t = useT();
    const editor = useSectionEditor('ticketFee', content.ticketFee, loading, showToast);
    const {draft, setDraft} = editor;
    const lang = isEnglish ? 'en' : 'zh';

    /** "$10 + $0.59 fee = $10.59" for one price under the fee being edited. */
    const previewAt = (price: number) => {
        const fee = ticketFeeFor(price, draft);
        return isEnglish
            ? `${formatPrice(price, lang)} + ${formatPrice(fee, lang)} fee = ${formatPrice(price + fee, lang)}`
            : `${formatPrice(price, lang)} + 手续费 ${formatPrice(fee, lang)} = ${formatPrice(price + fee, lang)}`;
    };

    // Against the saved tiers, since those are the prices visitors actually see.
    const previews = content.tickets.flatMap(tier => {
        const name = t(tier.name);
        const rows: string[] = [];
        if (tier.earlyBird && tier.earlyBird.price > 0) {
            rows.push(`${name} (${isEnglish ? 'early bird' : '早鸟'}): ${previewAt(tier.earlyBird.price)}`);
        }
        if (tier.price > 0) rows.push(`${name}: ${previewAt(tier.price)}`);
        return rows;
    });
    const charging = draft.percent > 0 || draft.flat > 0;

    return (
        <SectionShell
            section="ticketFee"
            helper={{
                en: 'What buying online adds to each paid ticket, shown on its card as “+ $0.59 transaction fee online”. Free tickets never show one. Leave both at 0 for no fee line.',
                zh: '线上购票时每张付费门票额外收取的费用，将在票种卡片上显示为「线上购票另收 $0.59 手续费」。免费门票不显示手续费。两项均为 0 时不显示。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <AmountField
                    label={{en: 'Percent of the price', zh: '按票价百分比'}}
                    unit={{en: '%', zh: '%'}}
                    max={100}
                    value={draft.percent}
                    onChange={next => setDraft(prev => ({...prev, percent: next}))}
                    readOnly={readOnly}
                />
                <AmountField
                    label={{en: 'Flat amount per ticket', zh: '每张固定金额'}}
                    value={draft.flat}
                    onChange={next => setDraft(prev => ({...prev, flat: next}))}
                    readOnly={readOnly}
                    helper={{en: 'Charged on top of the percent.', zh: '在百分比之外另加收取。'}}
                />
            </div>

            {charging && previews.length > 0 && (
                <div className="admin-mt-12">
                    <p className="admin-helper-text">
                        {isEnglish ? 'With the saved ticket prices:' : '按已保存的票价计算：'}
                    </p>
                    {previews.map((row, i) => (
                        <p key={i} className="admin-helper-text">{row}</p>
                    ))}
                </div>
            )}
        </SectionShell>
    );
};

export const InPersonSalesSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('inPersonSales', content.inPersonSales, loading, showToast);
    const {draft, setDraft} = editor;

    const updateSession = (index: number, next: InPersonSession) =>
        setDraft(prev => ({...prev, sessions: replaceAt(prev.sessions, index, next)}));

    return (
        <SectionShell
            section="inPersonSales"
            helper={{
                en: 'Days you sell tickets at a table in person. While any of them is still to come, a block under the ticket cards lists them — and, if the online fee above is set, tells visitors that buying there skips it. Each day drops off the page once it ends. Days are put in date order when you save.',
                zh: '现场摆摊售票的日期。只要还有未到的日期，门票卡片下方就会显示一个区块列出这些日期；若上方设置了线上手续费，还会提示访客在现场购票可免手续费。每个日期结束后会自动从页面上移除。保存时会按日期排序。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <LocalizedField
                    label={{en: 'Location', zh: '地点'}}
                    value={draft.location}
                    onChange={next => setDraft(prev => ({...prev, location: next}))}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Note (optional)', zh: '补充说明（可选）'}}
                    value={draft.note}
                    onChange={next => setDraft(prev => ({...prev, note: next}))}
                    readOnly={readOnly}
                    multiline
                />
            </div>

            <div className="admin-con-list admin-mt-12">
                {draft.sessions.length === 0 && (
                    <EmptyRow label={{
                        en: 'No sale days yet, so the page shows nothing for in-person sales.',
                        zh: '暂无售票日期，页面不会显示线下售票区块。',
                    }}/>
                )}

                {draft.sessions.map((session, index) => {
                    const closes = parseSiteTime(sessionBounds(session).closes).getTime();
                    const ended = Number.isFinite(closes) && closes <= Date.now();

                    return (
                        <div key={index} className="admin-con-card">
                            <div className="admin-con-card-head">
                                <span className="admin-con-card-title">
                                    {session.date
                                        ? formatSessionDay(session.date, isEnglish ? 'en' : 'zh')
                                        : (isEnglish ? `Day ${index + 1}` : `第 ${index + 1} 天`)}
                                </span>
                                {!readOnly && (
                                    <div className="admin-con-actions">
                                        <button
                                            type="button"
                                            className="admin-con-icon-btn admin-con-icon-btn--danger"
                                            onClick={() => setDraft(prev => ({
                                                ...prev,
                                                sessions: removeAt(prev.sessions, index),
                                            }))}
                                            aria-label={isEnglish ? 'Remove' : '删除'}
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="admin-form-grid">
                                <label className="admin-form-grid-full">
                                    <span>{isEnglish ? 'Date' : '日期'}</span>
                                    <input
                                        className="admin-input"
                                        type="date"
                                        value={session.date}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            date: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                    {ended && (
                                        <span className="admin-helper-text admin-mt-4 admin-con-warning">
                                            {isEnglish
                                                ? 'This day is over — it no longer shows on the page.'
                                                : '该日期已结束，页面上不再显示。'}
                                        </span>
                                    )}
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Opens (Pacific)' : '开始（太平洋时间）'}</span>
                                    <input
                                        className="admin-input"
                                        type="time"
                                        value={session.start}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            start: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Closes (Pacific)' : '结束（太平洋时间）'}</span>
                                    <input
                                        className="admin-input"
                                        type="time"
                                        value={session.end}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            end: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                </label>
                            </div>
                        </div>
                    );
                })}

                <AddButton
                    label={{en: 'sale day', zh: '售票日期'}}
                    onClick={() => setDraft(prev => {
                        // The table usually keeps the same hours day to day, so a new
                        // day starts from the last one's and only needs its date.
                        const last = prev.sessions[prev.sessions.length - 1];
                        return {
                            ...prev,
                            sessions: [...prev.sessions, {date: '', start: last?.start ?? '', end: last?.end ?? ''}],
                        };
                    })}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};
