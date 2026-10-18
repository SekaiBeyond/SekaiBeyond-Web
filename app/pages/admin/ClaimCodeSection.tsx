import { type ReactNode, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteStaffCode,
    callGenerateEventCode,
    callGenerateStaffCode,
    callSaveClaimCodeTimeWindow,
    callSaveStaffCodeTimeWindow,
    callToggleClaimCodeActive,
    callToggleStaffCodeActive,
    getFirebaseDb,
} from '~/lib/firebase';
import { formatCode } from '~/lib/codes';
import { formatSiteTime, parseSiteTime, toDatetimeLocal } from '~/lib/siteTime';
import type { BadgeCode } from './types';
import { getClaimUrl, type ShowToast } from './utils';

type Variant = 'checkin' | 'staff';

interface VariantText {
    label?: {en: string; cn: string};
    none: {en: string; cn: string};
    generate: {en: string; cn: string};
    generated: {en: string; cn: string};
    generateFailed: {en: string; cn: string};
    enabled: {en: string; cn: string};
    disabled: {en: string; cn: string};
    toggleFailed: {en: string; cn: string};
    loadFailed: {en: string; cn: string};
    regenConfirm: {en: string; cn: string};
}

const TEXT: Record<Variant, VariantText> = {
    checkin: {
        none: {en: 'No check-in code yet.', cn: '暂无签到码。'},
        generate: {en: '+ Generate Code', cn: '+ 生成签到码'},
        generated: {en: 'Check-in code generated.', cn: '签到码已生成。'},
        generateFailed: {en: 'Failed to generate code.', cn: '生成签到码失败。'},
        enabled: {en: 'Code enabled.', cn: '签到码已启用。'},
        disabled: {en: 'Code disabled.', cn: '签到码已停用。'},
        toggleFailed: {en: 'Failed to update code status.', cn: '更新签到码状态失败。'},
        loadFailed: {en: 'Failed to load event code.', cn: '加载活动码失败。'},
        regenConfirm: {
            en: 'This will deactivate the current code and generate a new one. Users with the old QR code will no longer be able to check in. Continue?',
            cn: '此操作将停用当前签到码并生成新码。持有旧二维码的用户将无法签到。是否继续？',
        },
    },
    staff: {
        label: {en: 'Staff Claim Code', cn: '工作人员码'},
        none: {en: 'No staff code yet.', cn: '暂无工作人员码。'},
        generate: {en: '+ Generate Staff Code', cn: '+ 生成工作人员码'},
        generated: {en: 'Staff code generated.', cn: '工作人员码已生成。'},
        generateFailed: {en: 'Failed to generate staff code.', cn: '生成工作人员码失败。'},
        enabled: {en: 'Staff code enabled.', cn: '工作人员码已启用。'},
        disabled: {en: 'Staff code disabled.', cn: '工作人员码已停用。'},
        toggleFailed: {en: 'Failed to update staff code status.', cn: '更新工作人员码状态失败。'},
        loadFailed: {en: 'Failed to load staff code.', cn: '加载工作人员码失败。'},
        regenConfirm: {
            en: 'This will delete the current staff code and generate a new one. Users with the old code will no longer be able to join as staff, while staff who joined with it stay staff. Continue?',
            cn: '此操作将删除当前工作人员码并生成新码。持有旧码的用户将无法再通过该码加入，已加入的工作人员不受影响。是否继续？',
        },
    },
};

type CodeState = 'active' | 'disabled' | 'scheduled' | 'expired' | 'used-up';

const codeState = (code: BadgeCode, now: Date): CodeState => {
    if (!code.active) return 'disabled';
    if (code.activeFrom && new Date(code.activeFrom) > now) return 'scheduled';
    if (code.activeUntil && new Date(code.activeUntil) < now) return 'expired';
    const maxUses = code.maxUses ?? 0;
    if (maxUses > 0 && (code.usedCount ?? 0) >= maxUses) return 'used-up';
    return 'active';
};

const STATE_TAG: Record<CodeState, {en: string; cn: string; className: string}> = {
    active: {en: 'Active', cn: '启用', className: 'admin-code-active-tag'},
    disabled: {en: 'Disabled', cn: '已停用', className: 'admin-code-inactive-tag'},
    scheduled: {en: 'Not started', cn: '未开始', className: 'admin-code-pending-tag'},
    expired: {en: 'Expired', cn: '已过期', className: 'admin-code-inactive-tag'},
    'used-up': {en: 'Used up', cn: '已用完', className: 'admin-code-pending-tag'},
};

const formatWhen = (value: string, isEnglish: boolean) =>
    formatSiteTime(new Date(value), isEnglish, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

const storedBound = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value) return null;
    const date = parseSiteTime(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const boundInput = (bound: string | null): string => bound ? toDatetimeLocal(new Date(bound)) : '';

const inputBound = (value: string): string | null => value ? parseSiteTime(value).toISOString() : null;

interface ClaimCodeSectionProps {
    eventId: string;
    variant: Variant;
    showToast: ShowToast;
    readOnly?: boolean;
    eventEndAt?: Date;
}

/**
 * One event's claim code: load, generate, toggle, and edit its time window.
 * Staff codes also work for past events; check-in codes are upcoming-only. The
 * staff variant is core-staff-only under the rules, so mount it only for them.
 */
export function ClaimCodeSection({eventId, variant, showToast, readOnly = false, eventEndAt}: ClaimCodeSectionProps) {
    const {isEnglish} = useLanguage();
    const isStaff = variant === 'staff';
    const text = TEXT[variant];
    const tr = (s: {en: string; cn: string}) => isEnglish ? s.en : s.cn;

    const api = isStaff
        ? {
            generate: () => callGenerateStaffCode({eventId}),
            toggle: (codeId: string, active: boolean) => callToggleStaffCodeActive({codeId, active}),
            saveWindow: (data: {codeId: string; activeFrom: string | null; activeUntil: string | null}) =>
                callSaveStaffCodeTimeWindow(data),
        }
        : {
            generate: () => callGenerateEventCode({eventId}),
            toggle: (codeId: string, active: boolean) => callToggleClaimCodeActive({codeId, active}),
            saveWindow: (data: {codeId: string; activeFrom: string | null; activeUntil: string | null}) =>
                callSaveClaimCodeTimeWindow(data),
        };

    const [code, setCode] = useState<BadgeCode | null>(null);
    const [codeFrom, setCodeFrom] = useState('');
    const [codeUntil, setCodeUntil] = useState('');
    const [limitUses, setLimitUses] = useState(false);
    const [maxUsesText, setMaxUsesText] = useState('');
    const [editingWindow, setEditingWindow] = useState(false);
    const [copied, setCopied] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [savingWindow, setSavingWindow] = useState(false);
    const [savingMaxUses, setSavingMaxUses] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    const resetMaxUsesDraft = (saved: number) => {
        setLimitUses(saved > 0);
        setMaxUsesText(saved > 0 ? String(saved) : '');
    };

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
            setLoadFailed(false);
            try {
                const db = getFirebaseDb();
                const collectionName = variant === 'staff' ? 'staffClaimCodes' : 'claimCodes';
                const snapshot = await getDocs(query(
                    collection(db, collectionName),
                    where('eventId', '==', eventId),
                ));
                if (stale) return;
                const codes: BadgeCode[] = snapshot.docs.map(docSnap => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        code: data.code,
                        active: data.active ?? true,
                        activeFrom: storedBound(data.activeFrom),
                        activeUntil: storedBound(data.activeUntil),
                        maxUses: data.maxUses ?? 0,
                        usedCount: data.usedCount ?? 0,
                    };
                });
                const picked = codes.find(c => c.active) ?? codes[0] ?? null;
                setCode(picked);
                setCodeFrom(boundInput(picked?.activeFrom ?? null));
                setCodeUntil(boundInput(picked?.activeUntil ?? null));
                resetMaxUsesDraft(picked?.maxUses ?? 0);
                setEditingWindow(false);
            } catch {
                if (!stale) {
                    setLoadFailed(true);
                    const msg = TEXT[variant].loadFailed;
                    showToast(isEnglish ? msg.en : msg.cn, 'error');
                }
            } finally {
                if (!stale) setLoading(false);
            }
        };
        void load();
        return () => {
            stale = true;
        };
        // Not keyed on isEnglish: a toggle would reload over an unsaved window.
    }, [eventId, variant, showToast]);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    const generateCode = async () => {
        setGenerating(true);
        try {
            const result = await api.generate();
            const {id, code: newCode} = result.data;
            setCode({
                id, code: newCode, active: true,
                activeFrom: null, activeUntil: null, maxUses: 0, usedCount: 0,
            });
            setCodeFrom('');
            setCodeUntil('');
            resetMaxUsesDraft(0);
            setEditingWindow(false);
            showToast(tr(text.generated), 'success');
        } catch {
            showToast(tr(text.generateFailed), 'error');
        } finally {
            setGenerating(false);
        }
    };

    const toggleActive = async () => {
        if (!code) return;
        const newActive = !code.active;
        setToggling(true);
        try {
            await api.toggle(code.id, newActive);
            setCode({...code, active: newActive});
            showToast(tr(newActive ? text.enabled : text.disabled), newActive ? 'success' : 'warning');
        } catch {
            showToast(tr(text.toggleFailed), 'error');
        } finally {
            setToggling(false);
        }
    };

    const saveTimeWindow = async () => {
        if (!code) return;
        const activeFrom = inputBound(codeFrom);
        const activeUntil = inputBound(codeUntil);
        setSavingWindow(true);
        try {
            await api.saveWindow({codeId: code.id, activeFrom, activeUntil});
            setCode({...code, activeFrom, activeUntil});
            setEditingWindow(false);
            showToast(isEnglish ? 'Time window saved.' : '时间窗口已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save time window.' : '保存时间窗口失败。', 'error');
        } finally {
            setSavingWindow(false);
        }
    };

    const deleteStaffCode = async () => {
        if (!code) return;
        const usedNote = code.usedCount
            ? (isEnglish ? ` It has been used ${code.usedCount} time(s); those staff stay staff.` : `此码已被使用 ${code.usedCount} 次，已加入的工作人员不受影响。`)
            : '';
        if (!window.confirm(
            isEnglish
                ? `Delete staff code "${formatCode(code.code)}"?${usedNote} This cannot be undone.`
                : `删除工作人员码"${formatCode(code.code)}"？${usedNote}此操作不可撤销。`
        )) return;
        setDeleting(true);
        try {
            await callDeleteStaffCode({codeId: code.id});
            setCode(null);
            setCodeFrom('');
            setCodeUntil('');
            resetMaxUsesDraft(0);
            setEditingWindow(false);
            showToast(isEnglish ? 'Staff code deleted.' : '工作人员码已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete staff code.' : '删除工作人员码失败。', 'error');
        } finally {
            setDeleting(false);
        }
    };

    const cancelWindowEdit = () => {
        setCodeFrom(boundInput(code?.activeFrom ?? null));
        setCodeUntil(boundInput(code?.activeUntil ?? null));
        setEditingWindow(false);
    };

    const savedMaxUses = code?.maxUses ?? 0;
    const usedCount = code?.usedCount ?? 0;
    const draftMaxUses = limitUses ? Number(maxUsesText) : 0;
    const draftMaxUsesValid = !limitUses || (Number.isInteger(draftMaxUses) && draftMaxUses >= 1);

    const saveMaxUses = async () => {
        if (!code || !draftMaxUsesValid) return;
        setSavingMaxUses(true);
        try {
            await callSaveStaffCodeTimeWindow({
                codeId: code.id,
                activeFrom: code.activeFrom,
                activeUntil: code.activeUntil,
                maxUses: draftMaxUses,
            });
            setCode({...code, maxUses: draftMaxUses});
            resetMaxUsesDraft(draftMaxUses);
            showToast(isEnglish ? 'Max uses saved.' : '最大次数已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save max uses.' : '保存最大次数失败。', 'error');
        } finally {
            setSavingMaxUses(false);
        }
    };

    const eventEndLocal = eventEndAt ? toDatetimeLocal(eventEndAt) : '';

    const copyValue = code ? (isStaff ? formatCode(code.code) : getClaimUrl(code.code)) : '';

    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(copyValue);
            setCopied(true);
        } catch {
            showToast(
                isEnglish ? 'Couldn\'t copy. Select the code and copy it by hand.' : '复制失败，请手动选择并复制。',
                'error',
            );
        }
    };

    if (loading) {
        return (
            <div className="admin-codes-section">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    const stateTag = code ? STATE_TAG[codeState(code, new Date())] : null;

    const staffHeader = isStaff && text.label && (
        <div className="admin-staff-code-head">
            <div>
                <h4 className="admin-staff-code-title">{tr(text.label)}</h4>
                <p className="admin-title-hint">
                    {isEnglish
                        ? 'Staff enter this code under Redeem Code in their account menu to join this event\'s staff.'
                        : '工作人员在账户菜单的「兑换激活码」中输入此码，即可成为本活动的工作人员。'}
                </p>
            </div>
            {stateTag && !loadFailed && (
                <span className={stateTag.className}>{tr(stateTag)}</span>
            )}
        </div>
    );

    // No Generate after a failed read: it retires existing codes without the regenerate warning.
    if (loadFailed) {
        return (
            <div className="admin-codes-section">
                {isStaff ? (
                    <div className="admin-staff-code">
                        {staffHeader}
                        <p className="admin-no-results">{tr(text.loadFailed)}</p>
                    </div>
                ) : (
                    <p className="admin-no-results">{tr(text.loadFailed)}</p>
                )}
            </div>
        );
    }

    const generateButton = !readOnly && (
        <button
            className="admin-btn admin-btn--dashed"
            onClick={() => void generateCode()}
            disabled={generating}
        >
            {generating
                ? (isEnglish ? 'Generating...' : '生成中...')
                : tr(text.generate)}
        </button>
    );

    if (!code) {
        return (
            <div className="admin-codes-section">
                {isStaff ? (
                    <div className="admin-staff-code">
                        {staffHeader}
                        <p className="admin-no-results admin-staff-code-empty">{tr(text.none)}</p>
                        {generateButton}
                    </div>
                ) : (
                    <>
                        <p className="admin-no-results">{tr(text.none)}</p>
                        {generateButton}
                    </>
                )}
            </div>
        );
    }

    const windowDirty = codeFrom !== boundInput(code.activeFrom) || codeUntil !== boundInput(code.activeUntil);
    const windowBackwards = !!codeFrom && !!codeUntil && codeFrom >= codeUntil;

    const windowFields = (trailing?: ReactNode) => (
        <>
            <div className="admin-code-time-inputs">
                <label>
                    <span>{isEnglish ? 'Active from' : '开始时间'}</span>
                    <input
                        type="datetime-local"
                        value={codeFrom}
                        onChange={(e) => setCodeFrom(e.target.value)}
                        className="admin-datetime-input"
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Active until' : '结束时间'}</span>
                    <input
                        type="datetime-local"
                        value={codeUntil}
                        onChange={(e) => setCodeUntil(e.target.value)}
                        className="admin-datetime-input"
                    />
                </label>
                {eventEndLocal && (
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={() => setCodeUntil(eventEndLocal)}
                        disabled={codeUntil === eventEndLocal}
                    >
                        {isEnglish ? 'Use Event End' : '设为活动结束时间'}
                    </button>
                )}
                {(codeFrom || codeUntil) && (
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={() => {
                            setCodeFrom('');
                            setCodeUntil('');
                        }}
                    >
                        {isEnglish ? 'Clear' : '清空'}
                    </button>
                )}
                {trailing}
            </div>
            <p className={windowBackwards ? 'admin-time-hint admin-time-hint--error' : 'admin-time-hint'}>
                {windowBackwards
                    ? (isEnglish ? 'Active until must be after active from.' : '结束时间必须晚于开始时间。')
                    : (isEnglish ? 'Pacific time. Leave empty for no time limit.' : '太平洋时间。留空表示不限时间。')}
            </p>
        </>
    );

    const saveWindowButton = (
        <button
            className="admin-toggle-btn admin-toggle-save"
            onClick={() => void saveTimeWindow()}
            disabled={!windowDirty || windowBackwards || savingWindow}
        >
            {savingWindow ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save' : '保存')}
        </button>
    );

    const codeActions = (
        <>
            <button
                className={`admin-toggle-btn ${code.active ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                onClick={() => void toggleActive()}
                disabled={toggling}
            >
                {code.active
                    ? (isEnglish ? 'Disable' : '停用')
                    : (isEnglish ? 'Enable' : '启用')}
            </button>
            <button
                className="admin-toggle-btn admin-toggle-revoke"
                onClick={() => {
                    if (window.confirm(tr(text.regenConfirm))) void generateCode();
                }}
                disabled={generating}
            >
                {generating
                    ? (isEnglish ? 'Regenerating...' : '重新生成中...')
                    : (isEnglish ? 'Regenerate' : '重新生成')}
            </button>
            {isStaff && !code.active && (
                <button
                    className="admin-toggle-btn admin-toggle-revoke"
                    onClick={() => void deleteStaffCode()}
                    disabled={deleting}
                >
                    {deleting ? (isEnglish ? 'Deleting...' : '删除中...') : (isEnglish ? 'Delete' : '删除')}
                </button>
            )}
        </>
    );

    const copyButton = (
        <button
            className={`admin-btn admin-btn--purple ${copied ? 'admin-btn--copied' : ''}`}
            onClick={() => void copyCode()}
        >
            {copied ? (isEnglish ? 'Copied ✓' : '已复制 ✓') : (isEnglish ? 'Copy' : '复制')}
        </button>
    );

    if (!isStaff) {
        return (
            <div className="admin-codes-section">
                <div className="admin-single-code">
                    <div className="admin-single-code-qr">
                        <QRCodeSVG value={copyValue} size={200} level="M"/>
                    </div>
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={copyValue}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        {copyButton}
                    </div>
                    {stateTag && <span className={stateTag.className}>{tr(stateTag)}</span>}
                    {!readOnly && (
                        <>
                            {windowFields(saveWindowButton)}
                            <div className="admin-single-code-actions">{codeActions}</div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    const hasSavedWindow = !!(code.activeFrom || code.activeUntil);
    const windowSummary = code.activeFrom && code.activeUntil
        ? `${formatWhen(code.activeFrom, isEnglish)} – ${formatWhen(code.activeUntil, isEnglish)}`
        : code.activeFrom
            ? (isEnglish ? 'From ' : '自 ') + formatWhen(code.activeFrom, isEnglish)
            : code.activeUntil
                ? (isEnglish ? 'Until ' : '至 ') + formatWhen(code.activeUntil, isEnglish)
                : (isEnglish ? 'Any time' : '不限时间');

    const usageFull = savedMaxUses > 0 && usedCount >= savedMaxUses;
    const maxUsesDirty = draftMaxUses !== savedMaxUses;
    const capClosesCode = limitUses && draftMaxUsesValid && maxUsesDirty && draftMaxUses <= usedCount;

    return (
        <div className="admin-codes-section">
            <div className="admin-staff-code">
                {staffHeader}

                <div className="admin-staff-code-value-row">
                    <code className={`admin-staff-code-value ${code.active ? '' : 'admin-staff-code-value--off'}`}>
                        {copyValue}
                    </code>
                    {copyButton}
                </div>

                <div className="admin-staff-code-usage">
                    <span>
                        {savedMaxUses > 0
                            ? (isEnglish ? `Used ${usedCount} of ${savedMaxUses}` : `已使用 ${usedCount} / ${savedMaxUses} 次`)
                            : (isEnglish
                                ? `Used ${usedCount} ${usedCount === 1 ? 'time' : 'times'} · no limit`
                                : `已使用 ${usedCount} 次 · 不限次数`)}
                    </span>
                    {savedMaxUses > 0 && (
                        <div className="admin-staff-code-meter" aria-hidden="true">
                            <div
                                className={`admin-staff-code-meter-fill ${usageFull ? 'admin-staff-code-meter-fill--full' : ''}`}
                                style={{width: `${Math.min(100, (usedCount / savedMaxUses) * 100)}%`}}
                            />
                        </div>
                    )}
                </div>

                {!readOnly && (
                    <>
                        <div className="admin-staff-code-settings">
                            <div className="admin-staff-code-setting">
                                <span className="admin-staff-code-setting-label">
                                    {isEnglish ? 'Uses' : '使用次数'}
                                </span>
                                <div className="admin-staff-code-setting-body">
                                    <label className="admin-unlimited-label">
                                        <input
                                            type="checkbox"
                                            checked={limitUses}
                                            onChange={(e) => {
                                                setLimitUses(e.target.checked);
                                                if (e.target.checked && !maxUsesText) {
                                                    setMaxUsesText(String(Math.max(10, usedCount + 1)));
                                                }
                                            }}
                                        />
                                        {isEnglish ? 'Limit to' : '限制为'}
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        inputMode="numeric"
                                        value={limitUses ? maxUsesText : ''}
                                        placeholder="∞"
                                        disabled={!limitUses}
                                        onChange={(e) => setMaxUsesText(e.target.value)}
                                        className="admin-number-input"
                                        aria-label={isEnglish ? 'Max uses' : '最大使用次数'}
                                    />
                                    <span className="admin-staff-code-unit">{isEnglish ? 'uses' : '次'}</span>
                                    <button
                                        className="admin-toggle-btn admin-toggle-save"
                                        onClick={() => void saveMaxUses()}
                                        disabled={!maxUsesDirty || !draftMaxUsesValid || savingMaxUses}
                                    >
                                        {savingMaxUses ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save' : '保存')}
                                    </button>
                                </div>
                                {capClosesCode && (
                                    <p className="admin-time-hint admin-time-hint--error">
                                        {isEnglish
                                            ? `This code has been used ${usedCount} ${usedCount === 1 ? 'time' : 'times'}, so a limit of ${draftMaxUses} stops anyone new from joining with it.`
                                            : `此码已使用 ${usedCount} 次，上限设为 ${draftMaxUses} 后将无法再有新的工作人员通过此码加入。`}
                                    </p>
                                )}
                            </div>

                            <div className="admin-staff-code-setting">
                                <span className="admin-staff-code-setting-label">
                                    {isEnglish ? 'Time window' : '时间窗口'}
                                </span>
                                {editingWindow ? (
                                    <div className="admin-staff-code-window-edit">
                                        {windowFields()}
                                        <div className="admin-staff-code-window-buttons">
                                            <button
                                                className="admin-toggle-btn admin-toggle-cancel"
                                                onClick={cancelWindowEdit}
                                                disabled={savingWindow}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                            {saveWindowButton}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="admin-staff-code-setting-body">
                                        <span
                                            className={hasSavedWindow ? 'admin-staff-code-window' : 'admin-staff-code-window admin-staff-code-window--none'}>
                                            {windowSummary}
                                        </span>
                                        <button
                                            className="admin-toggle-btn admin-toggle-edit"
                                            onClick={() => setEditingWindow(true)}
                                        >
                                            {hasSavedWindow ? (isEnglish ? 'Edit' : '编辑') : (isEnglish ? 'Set' : '设置')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="admin-staff-code-actions">{codeActions}</div>
                    </>
                )}
            </div>
        </div>
    );
}
