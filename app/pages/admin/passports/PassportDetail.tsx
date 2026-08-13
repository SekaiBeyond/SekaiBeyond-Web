import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callReissuePassportKey, callVoidPassport, getFirebaseDb } from '~/lib/firebase';
import {
    designName,
    fetchPassport,
    fetchPassportClaims,
    fetchPassportScans,
    type Passport,
    type PassportClaimEvent,
    type PassportDesign,
    passportScanUrl,
    passportStatusLabel,
} from '~/lib/passports';
import type { ScanEvent } from '~/lib/scans';
import { QrPreview } from '../tools/qr/qrExport';
import { QrScanTrends } from '../tools/qr/QrScanTrends';
import type { UserRecord } from '../types';
import { docToUserRecord, type ShowToast } from '../utils';
import { usePassportPngExport } from './passportExport';

const QR_SIZE = 200;

interface PassportDetailProps {
    passportId: string;
    /** The row that was clicked, so the page can paint before the refetch lands. */
    initial: Passport | null;
    /** All designs, so the page names the design of whatever it loads — a search
     * hit can be from a year other than the one the dashboard has open. */
    designs: PassportDesign[];
    onBack: () => void;
    onChanged: () => Promise<void>;
    onLookupUser: (uid: string) => void;
    showToast: ShowToast;
    readOnly: boolean;
}

/**
 * One passport's page: who holds it, how it has been scanned, and its permanent
 * audit trail.
 *
 * The only two write actions are for stock that has never been sold — void it, or
 * reissue its key slip. A claimed passport has no controls at all: the binding is
 * permanent by design, and membership it granted is adjusted through the user's
 * membership row, not from here.
 */
export const PassportDetail = ({
                                   passportId,
                                   initial,
                                   designs,
                                   onBack,
                                   onChanged,
                                   onLookupUser,
                                   showToast,
                                   readOnly,
                               }: PassportDetailProps) => {
    const {isEnglish} = useLanguage();
    const [passport, setPassport] = useState<Passport | null>(initial);
    const [missing, setMissing] = useState(false);
    const [owner, setOwner] = useState<UserRecord | null>(null);
    const [ownerMissing, setOwnerMissing] = useState(false);
    const [claims, setClaims] = useState<PassportClaimEvent[] | null>(null);
    const [scans, setScans] = useState<ScanEvent[] | null>(null);
    const [scansError, setScansError] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reissuedKey, setReissuedKey] = useState<string | null>(null);

    const {request: requestPng, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR code.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = passportScanUrl(passportId, origin);

    const reload = useCallback(async () => {
        const fresh = await fetchPassport(passportId);
        setPassport(fresh);
        setMissing(fresh === null);
        return fresh;
    }, [passportId]);

    useEffect(() => {
        void reload().catch(() => setMissing(true));
    }, [reload]);

    // Staff (read-only) can't read the claims subcollection — core-staff+ only —
    // so the request isn't made rather than failing visibly.
    useEffect(() => {
        if (readOnly) return;
        let stale = false;
        fetchPassportClaims(passportId)
            .then(list => {
                if (!stale) setClaims(list);
            })
            .catch(() => {
                if (!stale) setClaims([]);
            });
        return () => {
            stale = true;
        };
    }, [passportId, readOnly]);

    const loadScans = useCallback(() => {
        setScansError(false);
        setScans(null);
        fetchPassportScans(passportId)
            .then(setScans)
            .catch(() => setScansError(true));
    }, [passportId]);
    useEffect(loadScans, [loadScans]);

    const ownerUid = passport?.ownerUid ?? null;
    useEffect(() => {
        if (!ownerUid) {
            setOwner(null);
            setOwnerMissing(false);
            return;
        }
        let stale = false;
        getDoc(doc(getFirebaseDb(), 'users', ownerUid))
            .then(snap => {
                if (stale) return;
                if (snap.exists()) setOwner(docToUserRecord(snap));
                else setOwnerMissing(true);
            })
            .catch(() => {
                if (!stale) setOwnerMissing(true);
            });
        return () => {
            stale = true;
        };
    }, [ownerUid]);

    const fmtDate = (date: Date | null): string =>
        date
            ? date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
            : (isEnglish ? 'Never' : '从未');

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue)
            .then(() => showToast(isEnglish ? 'Link copied.' : '链接已复制。', 'success'))
            .catch(() => showToast(isEnglish ? 'Failed to copy.' : '复制失败。', 'error'));
    };

    const voidIt = async () => {
        if (!window.confirm(isEnglish
            ? `Void passport ${passportId}? Its sticker stops working for good and it can never be activated. Use this for stock that was destroyed or mispacked.`
            : `作废通行证 ${passportId}？其贴纸将永久失效且无法再被激活。请仅对已损毁或错误包装的库存使用。`)) return;
        setBusy(true);
        try {
            await callVoidPassport({passportId});
            await reload();
            await onChanged();
            showToast(isEnglish ? 'Passport voided.' : '通行证已作废。', 'warning');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to void passport.' : '作废通行证失败。'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const reissueKey = async () => {
        if (!window.confirm(isEnglish
            ? `Issue a new activation key for ${passportId}? The key on the current slip stops working immediately — print the replacement slip before packing it.`
            : `为 ${passportId} 签发新的激活码？当前纸条上的激活码将立即失效 — 请在装袋前打印新的纸条。`)) return;
        setBusy(true);
        try {
            const res = await callReissuePassportKey({passportId});
            setReissuedKey(res.data.activationCode);
            await reload();
            showToast(isEnglish ? 'New activation key issued.' : '已签发新的激活码。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to reissue the key.' : '重新签发激活码失败。'), 'error');
        } finally {
            setBusy(false);
        }
    };

    if (missing) {
        return (
            <div className="admin-section">
                <div className="admin-tools-back-row">
                    <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                        {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                    </button>
                </div>
                <p className="admin-no-results">{isEnglish ? 'Passport not found.' : '未找到通行证。'}</p>
            </div>
        );
    }

    if (!passport) {
        return (
            <div className="admin-section">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    const design = designs.find(d => d.year === passport.year);
    const locked = !!passport.lockedUntil && passport.lockedUntil.getTime() > Date.now();
    const unclaimed = passport.status === 'unclaimed';

    return (
        <div className="admin-section">
            <div className="admin-tools-back-row">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
            </div>

            <div className="admin-qr-detail-head">
                <div className="admin-qr-detail-title-row">
                    <h3 className="admin-qr-detail-title">{passport.id}</h3>
                    <span className={`admin-qr-badge admin-qr-badge-lg admin-passport-badge--${passport.status}`}>
                        {passportStatusLabel(passport.status, isEnglish)}
                    </span>
                    {locked && (
                        <span className="admin-qr-badge admin-qr-badge-expired">
                            {isEnglish ? 'Locked' : '已锁定'}
                        </span>
                    )}
                </div>
                <p className="admin-qr-detail-subtitle">
                    {passport.year} · {designName(design, passport.year, isEnglish)}
                </p>
            </div>

            <div className="admin-qr-detail-top">
                <div className="admin-qr-detail-code">
                    <div className="admin-qr-paper">
                        <QrPreview value={scanValue} size={QR_SIZE}/>
                        <p className="admin-passport-sticker-code">{passport.id}</p>
                    </div>
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={scanValue}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        <button className="admin-btn admin-btn--purple" onClick={copyLink} type="button">
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={() => requestPng([passport.id], `passport-${passport.id}`)}
                        type="button"
                    >
                        {isEnglish ? 'Download sticker PNG' : '下载贴纸 PNG'}
                    </button>
                </div>

                <div className="admin-qr-detail-meta">
                    <div className="admin-stats-tiles">
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">{isEnglish ? 'Scans' : '扫描数'}</div>
                            <div className="admin-stats-tile-value">{passport.scanCount}</div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">{isEnglish ? 'Last Scan' : '最近扫描'}</div>
                            <div className="admin-stats-tile-value admin-stats-tile-value--sm">
                                {fmtDate(passport.lastScanAt)}
                            </div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">{isEnglish ? 'Term' : '有效期'}</div>
                            <div className="admin-stats-tile-value admin-stats-tile-value--sm">
                                {isEnglish ? `${passport.termDays} days` : `${passport.termDays} 天`}
                            </div>
                        </div>
                    </div>

                    <dl className="admin-qr-detail-list">
                        <div>
                            <dt>{isEnglish ? 'Holder' : '持有者'}</dt>
                            <dd>
                                {passport.status !== 'claimed' ? (
                                    isEnglish ? 'Not activated yet' : '尚未激活'
                                ) : owner ? (
                                    <>
                                        <span className="record-clickable-name"
                                              onClick={() => onLookupUser(owner.uid)}>
                                            {owner.displayName}
                                        </span>
                                        <span className="admin-user-email"> {owner.email}</span>
                                    </>
                                ) : ownerMissing ? (
                                    isEnglish
                                        ? 'Account deleted — the passport stays bound and no longer resolves.'
                                        : '账号已删除 — 通行证仍保持绑定，且页面不再显示。'
                                ) : (
                                    <span className="spinner"/>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Activated' : '激活时间'}</dt>
                            <dd>{passport.claimedAt ? fmtDate(passport.claimedAt) : (isEnglish ? '—' : '—')}</dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Generated' : '生成时间'}</dt>
                            <dd>
                                {fmtDate(passport.createdAt)}
                                {passport.createdByName && ` · ${passport.createdByName}`}
                            </dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Key slip' : '激活码纸条'}</dt>
                            <dd>
                                {passport.status === 'claimed'
                                    ? (isEnglish ? 'Spent on activation' : '已在激活时使用')
                                    : passport.status === 'void'
                                        ? (isEnglish ? 'Discarded with the void' : '已随作废一并废除')
                                        : (isEnglish
                                            ? `Issued ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · reissued ${passport.keyReissueCount}×` : ''}`
                                            : `签发于 ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · 已重新签发 ${passport.keyReissueCount} 次` : ''}`)}
                            </dd>
                        </div>
                        {locked && passport.lockedUntil && (
                            <div>
                                <dt>{isEnglish ? 'Locked until' : '锁定至'}</dt>
                                <dd>{fmtDate(passport.lockedUntil)}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>

            {reissuedKey && (
                <div className="admin-passport-warning admin-passport-warning--urgent">
                    <strong>{isEnglish ? 'New activation key' : '新的激活码'}</strong>
                    <p className="admin-passport-key-secret">{reissuedKey}</p>
                    <p>
                        {isEnglish
                            ? 'Shown once. Print the replacement slip now — it is stored only as a hash.'
                            : '仅显示一次。请立即打印替换纸条 — 系统中只保存其哈希值。'}
                    </p>
                </div>
            )}

            <div className="admin-field-section admin-qr-section">
                <div className="admin-qr-spot-header">
                    <span className="admin-field-label">{isEnglish ? 'Scans Over Time' : '扫描时间趋势'}</span>
                    <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm" onClick={loadScans}>
                        {isEnglish ? 'Refresh' : '刷新'}
                    </button>
                </div>
                {scansError ? (
                    <p className="admin-no-results">{isEnglish ? 'Failed to load scans.' : '加载扫描记录失败。'}</p>
                ) : scans === null ? (
                    <div className="spinner spinner-centered"/>
                ) : (
                    <QrScanTrends key={passport.id} scans={scans}/>
                )}
            </div>

            {!readOnly && (
                <div className="admin-field-section admin-qr-section">
                    <span className="admin-field-label">{isEnglish ? 'History' : '历史记录'}</span>
                    {claims === null ? (
                        <div className="spinner spinner-centered"/>
                    ) : claims.length === 0 ? (
                        <p className="admin-no-results">{isEnglish ? 'Nothing recorded yet.' : '暂无记录。'}</p>
                    ) : (
                        <div className="admin-passport-history">
                            {claims.map(event => (
                                <div key={event.id} className="admin-passport-history-row">
                                    <span className={`record-type-tag admin-passport-action--${event.action}`}>
                                        {actionLabel(event.action, isEnglish)}
                                    </span>
                                    <span className="admin-passport-history-text">
                                        {event.performedByName || event.performedBy || (isEnglish ? 'System' : '系统')}
                                        {event.daysGranted !== null && (isEnglish
                                            ? ` · +${event.daysGranted} days`
                                            : ` · +${event.daysGranted} 天`)}
                                    </span>
                                    <span className="record-time">{fmtDate(event.at)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!readOnly && unclaimed && (
                <div className="admin-qr-danger-row">
                    <button
                        className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                        onClick={() => void reissueKey()}
                        disabled={busy}
                    >
                        {isEnglish ? 'Reissue key slip' : '重新签发激活码纸条'}
                    </button>
                    <button
                        className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                        onClick={() => void voidIt()}
                        disabled={busy}
                    >
                        {isEnglish ? 'Void passport' : '作废通行证'}
                    </button>
                </div>
            )}
            {!readOnly && passport.status === 'claimed' && (
                <p className="admin-helper-text admin-field-hint">
                    {isEnglish
                        ? 'A claimed passport is permanently bound to its holder: it can’t be unbound, rebound, or voided. To adjust what it granted, edit the holder’s membership in Users Management.'
                        : '已激活的通行证与持有者永久绑定：无法解绑、转绑或作废。若需调整其授予的会员资格，请在用户管理中修改该用户的会员期限。'}
                </p>
            )}
            {pngNode}
        </div>
    );
};

const actionLabel = (action: PassportClaimEvent['action'], isEnglish: boolean): string => {
    if (action === 'void') return isEnglish ? 'Void' : '作废';
    if (action === 'key-reissue') return isEnglish ? 'Key' : '激活码';
    return isEnglish ? 'Claim' : '激活';
};
