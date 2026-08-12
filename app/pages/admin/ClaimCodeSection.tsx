import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callGenerateEventCode,
    callGenerateStaffCode,
    callSaveClaimCodeTimeWindow,
    callSaveStaffCodeTimeWindow,
    callToggleClaimCodeActive,
    callToggleStaffCodeActive,
    getFirebaseDb,
} from '~/lib/firebase';
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
            en: 'This will deactivate the current staff code and generate a new one. Users with the old code will no longer be able to join as staff. Continue?',
            cn: '此操作将停用当前工作人员码并生成新码。持有旧码的用户将无法再通过该码加入。是否继续？',
        },
    },
};

interface ClaimCodeSectionProps {
    eventId: string;
    /**
     * 'checkin': attendee check-in codes ('claimCodes'), shown as a claim-URL QR.
     * 'staff': staff claim codes ('staffClaimCodes'), a raw code with a max-uses cap.
     */
    variant: Variant;
    showToast: ShowToast;
    readOnly?: boolean;
}

/**
 * Self-contained claim-code manager for a single event: loads the event's code,
 * generates/regenerates it, toggles it, and edits its active time window. Works
 * for both upcoming and past events — the generate/claim Cloud Functions resolve
 * the event from either collection. The staff variant is core-staff-only per
 * Firestore rules, so mount it only for core staff.
 */
export function ClaimCodeSection({eventId, variant, showToast, readOnly = false}: ClaimCodeSectionProps) {
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
    const [maxUses, setMaxUses] = useState(0);
    const [generating, setGenerating] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
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
                        eventId: data.eventId ?? '',
                        active: data.active ?? true,
                        activeFrom: data.activeFrom ?? null,
                        activeUntil: data.activeUntil ?? null,
                        maxUses: data.maxUses ?? 0,
                    };
                });
                const picked = codes.find(c => c.active) ?? codes[0] ?? null;
                setCode(picked);
                setCodeFrom(picked?.activeFrom ?? '');
                setCodeUntil(picked?.activeUntil ?? '');
                setMaxUses(picked?.maxUses ?? 0);
            } catch {
                if (!stale) {
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
    }, [eventId, variant, isEnglish, showToast]);

    const generateCode = async () => {
        setGenerating(true);
        try {
            const result = await api.generate();
            const {id, code: newCode} = result.data;
            setCode({id, code: newCode, eventId, active: true, activeFrom: null, activeUntil: null});
            setCodeFrom('');
            setCodeUntil('');
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
        try {
            await api.toggle(code.id, newActive);
            setCode({...code, active: newActive});
            showToast(tr(newActive ? text.enabled : text.disabled), newActive ? 'success' : 'warning');
        } catch {
            showToast(tr(text.toggleFailed), 'error');
        }
    };

    const saveTimeWindow = async () => {
        if (!code) return;
        const activeFrom = codeFrom || null;
        const activeUntil = codeUntil || null;
        try {
            await api.saveWindow({codeId: code.id, activeFrom, activeUntil});
            setCode({...code, activeFrom, activeUntil});
            showToast(isEnglish ? 'Time window saved.' : '时间窗口已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save time window.' : '保存时间窗口失败。', 'error');
        }
    };

    const saveMaxUses = async () => {
        if (!code) return;
        try {
            await callSaveStaffCodeTimeWindow({
                codeId: code.id,
                activeFrom: code.activeFrom,
                activeUntil: code.activeUntil,
                maxUses,
            });
            setCode({...code, maxUses});
            showToast(isEnglish ? 'Max uses saved.' : '最大次数已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save max uses.' : '保存最大次数失败。', 'error');
        }
    };

    // Staff codes are claimed by typing the code; check-in codes by scanning the claim URL.
    const copyValue = code ? (isStaff ? code.code : getClaimUrl(code.code)) : '';

    if (loading) {
        return (
            <div className="admin-codes-section">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    return (
        <div className="admin-codes-section">
            {text.label && (
                <p className="admin-section-label">{tr(text.label)}</p>
            )}
            {!code ? (
                <>
                    <p className="admin-no-results">{tr(text.none)}</p>
                    {!readOnly && (
                        <button
                            className="admin-btn admin-btn--dashed"
                            onClick={() => void generateCode()}
                            disabled={generating}
                        >
                            {generating
                                ? (isEnglish ? 'Generating...' : '生成中...')
                                : tr(text.generate)}
                        </button>
                    )}
                </>
            ) : (
                <div className="admin-single-code">
                    {!isStaff && (
                        <div className="admin-single-code-qr">
                            <QRCodeSVG value={copyValue} size={200} level="M"/>
                        </div>
                    )}
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={copyValue}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        <button
                            className="admin-btn admin-btn--purple"
                            onClick={() => navigator.clipboard.writeText(copyValue)}
                        >
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <span className={code.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                        {code.active
                            ? (isEnglish ? 'Active' : '启用')
                            : (isEnglish ? 'Disabled' : '已停用')}
                    </span>
                    {!readOnly && (
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
                                <button
                                    className="admin-toggle-btn admin-toggle-save"
                                    onClick={() => void saveTimeWindow()}
                                    disabled={codeFrom === (code.activeFrom ?? '') && codeUntil === (code.activeUntil ?? '')}
                                >
                                    {isEnglish ? 'Save' : '保存'}
                                </button>
                            </div>
                            <p className="admin-time-hint">
                                {isEnglish ? 'Leave empty for no time limit.' : '留空表示不限时间。'}
                            </p>
                            {isStaff && (
                                <>
                                    <label className="admin-max-uses-label">
                                        <span>{isEnglish ? 'Max uses (0 = unlimited)' : '最大使用次数（0 = 不限）'}</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={maxUses}
                                            onChange={(e) => setMaxUses(Number(e.target.value))}
                                            className="admin-number-input"
                                        />
                                    </label>
                                    <button
                                        className="admin-toggle-btn admin-toggle-save"
                                        onClick={() => void saveMaxUses()}
                                        disabled={maxUses === (code.maxUses ?? 0)}
                                    >
                                        {isEnglish ? 'Save Max Uses' : '保存最大次数'}
                                    </button>
                                </>
                            )}
                            <div className="admin-single-code-actions">
                                <button
                                    className={`admin-toggle-btn ${code.active ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                    onClick={() => void toggleActive()}
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
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
