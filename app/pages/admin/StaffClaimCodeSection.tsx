import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callGenerateStaffCode,
    callSaveStaffCodeTimeWindow,
    callToggleStaffCodeActive,
    getFirebaseDb,
} from '~/lib/firebase';
import type { BadgeCode } from './types';
import type { ShowToast } from './utils';

interface StaffClaimCodeSectionProps {
    eventId: string;
    showToast: ShowToast;
}

// Self-contained staff claim code manager for a single event. Works for both
// upcoming and past events — the generate/claim Cloud Functions resolve the event
// from either collection, so admins can credit staff retroactively on past events.
// Mount only for core-staff (staffClaimCodes reads are core-staff-only per rules).
export function StaffClaimCodeSection({eventId, showToast}: StaffClaimCodeSectionProps) {
    const {isEnglish} = useLanguage();
    const [staffCode, setStaffCode] = useState<BadgeCode | null>(null);
    const [staffCodeFrom, setStaffCodeFrom] = useState('');
    const [staffCodeUntil, setStaffCodeUntil] = useState('');
    const [staffCodeMaxUses, setStaffCodeMaxUses] = useState(0);
    const [generatingStaffCode, setGeneratingStaffCode] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
            try {
                const db = getFirebaseDb();
                const snapshot = await getDocs(query(
                    collection(db, 'staffClaimCodes'),
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
                setStaffCode(picked);
                setStaffCodeFrom(picked?.activeFrom ?? '');
                setStaffCodeUntil(picked?.activeUntil ?? '');
                setStaffCodeMaxUses(picked?.maxUses ?? 0);
            } catch {
                if (!stale) {
                    showToast(isEnglish ? 'Failed to load staff code.' : '加载工作人员码失败。', 'error');
                }
            } finally {
                if (!stale) setLoading(false);
            }
        };
        void load();
        return () => {
            stale = true;
        };
    }, [eventId, isEnglish, showToast]);

    const generateStaffCodeFn = async () => {
        setGeneratingStaffCode(true);
        try {
            const result = await callGenerateStaffCode({eventId});
            const {id, code} = result.data;
            setStaffCode({id, code, eventId, active: true, activeFrom: null, activeUntil: null});
            setStaffCodeFrom('');
            setStaffCodeUntil('');
            showToast(isEnglish ? 'Staff code generated.' : '工作人员码已生成。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to generate staff code.' : '生成工作人员码失败。', 'error');
        } finally {
            setGeneratingStaffCode(false);
        }
    };

    const toggleStaffCodeActiveFn = async () => {
        if (!staffCode) return;
        const newActive = !staffCode.active;
        try {
            await callToggleStaffCodeActive({codeId: staffCode.id, active: newActive});
            setStaffCode({...staffCode, active: newActive});
            showToast(
                newActive
                    ? (isEnglish ? 'Staff code enabled.' : '工作人员码已启用。')
                    : (isEnglish ? 'Staff code disabled.' : '工作人员码已停用。'),
                newActive ? 'success' : 'warning',
            );
        } catch {
            showToast(isEnglish ? 'Failed to update staff code status.' : '更新工作人员码状态失败。', 'error');
        }
    };

    const saveStaffCodeTimeWindowFn = async () => {
        if (!staffCode) return;
        const activeFrom = staffCodeFrom || null;
        const activeUntil = staffCodeUntil || null;
        try {
            await callSaveStaffCodeTimeWindow({codeId: staffCode.id, activeFrom, activeUntil});
            setStaffCode({...staffCode, activeFrom, activeUntil});
            showToast(isEnglish ? 'Time window saved.' : '时间窗口已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save time window.' : '保存时间窗口失败。', 'error');
        }
    };

    const saveStaffCodeMaxUsesFn = async () => {
        if (!staffCode) return;
        try {
            await callSaveStaffCodeTimeWindow({
                codeId: staffCode.id,
                activeFrom: staffCode.activeFrom,
                activeUntil: staffCode.activeUntil,
                maxUses: staffCodeMaxUses,
            });
            setStaffCode({...staffCode, maxUses: staffCodeMaxUses});
            showToast(isEnglish ? 'Max uses saved.' : '最大次数已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save max uses.' : '保存最大次数失败。', 'error');
        }
    };

    if (loading) {
        return (
            <div className="admin-codes-section">
                <div className="profile-spinner admin-spinner-center"/>
            </div>
        );
    }

    return (
        <div className="admin-codes-section">
            <p className="admin-section-label">
                {isEnglish ? 'Staff Claim Code' : '工作人员码'}
            </p>
            {!staffCode ? (
                <>
                    <p className="admin-no-results">
                        {isEnglish ? 'No staff code yet.' : '暂无工作人员码。'}
                    </p>
                    <button
                        className="admin-btn admin-btn--dashed"
                        onClick={generateStaffCodeFn}
                        disabled={generatingStaffCode}
                    >
                        {generatingStaffCode
                            ? (isEnglish ? 'Generating...' : '生成中...')
                            : (isEnglish ? '+ Generate Staff Code' : '+ 生成工作人员码')}
                    </button>
                </>
            ) : (
                <div className="admin-single-code">
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={staffCode.code}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        <button
                            className="admin-btn admin-btn--purple"
                            onClick={() => navigator.clipboard.writeText(staffCode.code)}
                        >
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <span
                        className={staffCode.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                            {staffCode.active
                                ? (isEnglish ? 'Active' : '启用')
                                : (isEnglish ? 'Disabled' : '已停用')}
                        </span>
                    <div className="admin-code-time-inputs">
                        <label>
                            <span>{isEnglish ? 'Active from' : '开始时间'}</span>
                            <input
                                type="datetime-local"
                                value={staffCodeFrom}
                                onChange={(e) => setStaffCodeFrom(e.target.value)}
                                className="admin-datetime-input"
                            />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Active until' : '结束时间'}</span>
                            <input
                                type="datetime-local"
                                value={staffCodeUntil}
                                onChange={(e) => setStaffCodeUntil(e.target.value)}
                                className="admin-datetime-input"
                            />
                        </label>
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={saveStaffCodeTimeWindowFn}
                            disabled={staffCodeFrom === (staffCode.activeFrom ?? '') && staffCodeUntil === (staffCode.activeUntil ?? '')}
                        >
                            {isEnglish ? 'Save' : '保存'}
                        </button>
                    </div>
                    <p className="admin-time-hint">
                        {isEnglish ? 'Leave empty for no time limit.' : '留空表示不限时间。'}
                    </p>
                    <label className="admin-max-uses-label">
                        <span>{isEnglish ? 'Max uses (0 = unlimited)' : '最大使用次数（0 = 不限）'}</span>
                        <input
                            type="number"
                            min="0"
                            value={staffCodeMaxUses}
                            onChange={(e) => setStaffCodeMaxUses(Number(e.target.value))}
                            className="admin-number-input"
                        />
                    </label>
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={saveStaffCodeMaxUsesFn}
                        disabled={staffCodeMaxUses === (staffCode.maxUses ?? 0)}
                    >
                        {isEnglish ? 'Save Max Uses' : '保存最大次数'}
                    </button>
                    <div className="admin-single-code-actions">
                        <button
                            className={`admin-toggle-btn ${staffCode.active ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                            onClick={toggleStaffCodeActiveFn}
                        >
                            {staffCode.active
                                ? (isEnglish ? 'Disable' : '停用')
                                : (isEnglish ? 'Enable' : '启用')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-revoke"
                            onClick={() => {
                                const msg = isEnglish
                                    ? 'This will deactivate the current staff code and generate a new one. Users with the old code will no longer be able to join as staff. Continue?'
                                    : '此操作将停用当前工作人员码并生成新码。持有旧码的用户将无法再通过该码加入。是否继续？';
                                if (window.confirm(msg)) void generateStaffCodeFn();
                            }}
                            disabled={generatingStaffCode}
                        >
                            {generatingStaffCode
                                ? (isEnglish ? 'Regenerating...' : '重新生成中...')
                                : (isEnglish ? 'Regenerate' : '重新生成')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
