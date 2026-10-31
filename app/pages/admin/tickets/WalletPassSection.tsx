import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdateWalletPassSettings, errorSuffix } from '~/lib/firebase';
import { useSiteConfig } from '~/lib/siteConfig';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { ShowToast } from '../utils';
import { WalletPassPreview } from './WalletPassPreview';
import {
    sameWalletPassSettings,
    WALLET_COLOR_NAMES,
    WALLET_COLOR_STYLES,
    WALLET_COLORS,
    WALLET_PASS_MAX_NOTES,
    type WalletPassSettings,
    walletTicketStyle,
} from './walletPass';

interface WalletPassSectionProps {
    event: UpcomingEvent;
    /** The stored settings, null while they load. */
    settings: WalletPassSettings | null;
    /** Passes made for the event and not revoked. */
    passCount: number;
    loadFailed: boolean;
    readOnly: boolean;
    showToast: ShowToast;
}

/**
 * How the event's Add to Wallet passes look, beside a preview. Read when each
 * pass is made, so a change reaches passes made after it.
 */
export function WalletPassSection({
                                      event,
                                      settings,
                                      passCount,
                                      loadFailed,
                                      readOnly,
                                      showToast
                                  }: WalletPassSectionProps) {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();
    const [draft, setDraft] = useState<WalletPassSettings | null>(null);
    const [saving, setSaving] = useState(false);

    // Filled from the stored settings once they load, then left to the form.
    useEffect(() => {
        if (settings && !draft) setDraft(settings);
    }, [settings, draft]);

    if (loadFailed) {
        return (
            <p className="admin-no-results">
                {isEnglish
                    ? 'Could not load this event’s wallet pass settings. Reload the page before editing them.'
                    : '无法加载此活动的钱包票券设置。请重新加载页面后再编辑。'}
            </p>
        );
    }
    if (!settings || !draft) return <div className="spinner spinner-centered"/>;

    const update = (changes: Partial<WalletPassSettings>) => {
        if (!readOnly) setDraft(prev => prev && {...prev, ...changes});
    };
    const updateNote = (i: number, changes: Partial<{label: string; value: string}>) =>
        update({notes: draft.notes.map((n, j) => j === i ? {...n, ...changes} : n)});

    const unchanged = sameWalletPassSettings(draft, settings);
    // A line with a label and no text isn't kept.
    const textless = draft.notes.some(n => n.label.trim() && !n.value.trim());

    const save = async () => {
        setSaving(true);
        try {
            const notes = draft.notes
                .map(n => ({label: n.label.trim(), value: n.value.trim()}))
                .filter(n => n.value);
            await callUpdateWalletPassSettings({
                eventId: event.id,
                enabled: draft.enabled,
                color: draft.color,
                headerText: draft.headerText.trim(),
                notes,
            });
            setDraft({...draft, headerText: draft.headerText.trim(), notes});
            showToast(isEnglish ? 'Wallet pass saved.' : '钱包票券已保存。', 'success');
        } catch (err) {
            showToast(
                isEnglish ? `Could not save the wallet pass${errorSuffix(err, true)}.` : `无法保存钱包票券${errorSuffix(err, false)}。`,
                'error',
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="admin-tickets-template">
            <h3>{isEnglish ? 'Wallet pass' : '钱包票券'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Each ticket in this event’s emails has an Add to Wallet button, whose first tap makes an Apple or Google Wallet pass like the one below. Changes reach passes made after you save; one already in someone’s wallet keeps its look, as WalletWallet’s free plan can’t update a pass.'
                    : '此活动邮件中的每张门票都有"添加到钱包"按钮，首次点击时会生成如下所示的 Apple / Google 钱包票券。修改仅对保存后生成的票券生效；已在钱包中的票券保持原样，因为 WalletWallet 免费方案无法更新票券。'}
            </p>
            <p className="admin-helper-text">
                <strong>
                    {passCount === 0
                        ? (isEnglish ? 'No passes made yet' : '尚未生成任何票券')
                        : isEnglish
                            ? `${passCount} pass${passCount === 1 ? '' : 'es'} made so far`
                            : `已生成 ${passCount} 张票券`}
                </strong>
                {passCount === 0
                    ? (isEnglish ? ', so a change here reaches every pass.' : '，因此此处的修改会作用于所有票券。')
                    : (isEnglish
                        ? ', which keep the look and event details they were made with.'
                        : '，这些票券将保持生成时的样式与活动信息。')}
            </p>

            <label className="admin-wallet-toggle">
                <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={readOnly}
                    onChange={e => update({enabled: e.target.checked})}
                />
                <span>
                    {isEnglish
                        ? 'Add to Wallet button in this event’s ticket emails'
                        : '在此活动的门票邮件中显示"添加到钱包"按钮'}
                </span>
            </label>

            {draft.enabled && (
                <div className="admin-wallet-layout">
                    <div className="admin-wallet-form">
                        <div className="admin-tickets-template-field">
                            <span>{isEnglish ? 'Color' : '颜色'}</span>
                            <div className="admin-wallet-colors" role="radiogroup">
                                {(['auto', ...WALLET_COLORS] as const).map(color => (
                                    <button
                                        key={color}
                                        type="button"
                                        role="radio"
                                        aria-checked={draft.color === color}
                                        className={`admin-wallet-color${draft.color === color ? ' is-selected' : ''}`}
                                        disabled={readOnly}
                                        onClick={() => update({color})}
                                    >
                                        <i
                                            className="admin-wallet-swatch"
                                            style={{
                                                background: color === 'auto'
                                                    ? `conic-gradient(${['normal', 'vip', 'vendor', 'guest', 'student', 'Comp Ticket']
                                                        .map(t => WALLET_COLOR_STYLES[walletTicketStyle(t).color].bg).join(', ')})`
                                                    : WALLET_COLOR_STYLES[color].bg,
                                            }}
                                        />
                                        {isEnglish ? WALLET_COLOR_NAMES[color].en : WALLET_COLOR_NAMES[color].zh}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="admin-tickets-template-field">
                            <span>{isEnglish ? 'Back of the pass' : '票券背面'}</span>
                            <small className="admin-time-hint">
                                {isEnglish
                                    ? `Up to ${WALLET_PASS_MAX_NOTES} lines after the ticket ID, ticket type and contact: entry instructions, an address, a link. Links, phone numbers and emails can be tapped.`
                                    : `在门票编号、门票类型和联系方式之后最多添加 ${WALLET_PASS_MAX_NOTES} 行：入场须知、地址、链接等。链接、电话和邮箱可直接点击。`}
                            </small>
                            {draft.notes.map((note, i) => (
                                <div key={i} className="admin-wallet-note">
                                    <input
                                        className="admin-input"
                                        type="text"
                                        maxLength={64}
                                        value={note.label}
                                        readOnly={readOnly}
                                        placeholder={isEnglish ? 'Label, e.g. Entry' : '标题，例如：入场'}
                                        onChange={e => updateNote(i, {label: e.target.value})}
                                    />
                                    <textarea
                                        className="admin-tickets-template-textarea admin-wallet-note-text"
                                        rows={2}
                                        maxLength={256}
                                        value={note.value}
                                        readOnly={readOnly}
                                        placeholder={isEnglish ? 'Text, e.g. Doors open at 6:30 PM' : '内容，例如：18:30 开始入场'}
                                        onChange={e => updateNote(i, {value: e.target.value})}
                                    />
                                    {!readOnly && (
                                        <button
                                            type="button"
                                            className="admin-btn admin-btn--link"
                                            onClick={() => update({notes: draft.notes.filter((_, j) => j !== i)})}
                                        >
                                            {isEnglish ? 'Remove' : '删除'}
                                        </button>
                                    )}
                                </div>
                            ))}
                            {textless && (
                                <small className="admin-time-hint admin-time-hint--error">
                                    {isEnglish ? 'A line with no text isn’t saved.' : '没有内容的行不会被保存。'}
                                </small>
                            )}
                            {!readOnly && draft.notes.length < WALLET_PASS_MAX_NOTES && (
                                <button
                                    type="button"
                                    className="admin-btn admin-btn--link admin-wallet-add"
                                    onClick={() => update({notes: [...draft.notes, {label: '', value: ''}]})}
                                >
                                    {isEnglish ? '+ Add a line' : '+ 添加一行'}
                                </button>
                            )}
                        </div>
                    </div>

                    <WalletPassPreview event={event} settings={draft} contactEmail={config.contactEmail}/>
                </div>
            )}

            {!readOnly && (
                <div className="admin-btn-row">
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={() => void save()}
                        disabled={saving || unchanged}
                    >
                        {saving
                            ? (isEnglish ? 'Saving...' : '保存中...')
                            : (isEnglish ? 'Save wallet pass' : '保存钱包票券')}
                    </button>
                </div>
            )}
        </div>
    );
}
