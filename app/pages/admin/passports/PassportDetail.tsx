import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteClaimedPassport,
    callDeletePassports,
    callReissuePassportKey,
    callRevealPassportKey,
    getFirebaseDb,
} from '~/lib/firebase';
import {
    fetchPassport,
    fetchPassportClaims,
    type Passport,
    type PassportClaimEvent,
    passportDateTime,
    passportName,
    passportScanUrl,
    passportStatusLabel,
    usePassportDesigns,
} from '~/lib/passports';
import { QrPreview } from '../tools/qr/qrExport';
import type { UserRecord } from '../types';
import { docToUserRecord, type ShowToast } from '../utils';
import { usePassportPngExport } from './passportExport';

const QR_SIZE = 200;
const MASKED_KEY = '••••-••••-••••';

interface PassportDetailProps {
    passportId: string;
    /** The row that was clicked, so the page can paint before the refetch lands. */
    initial: Passport | null;
    onBack: () => void;
    /** Hands the refetched passport back so the list can patch it in place. */
    onChanged: (fresh: Passport) => void;
    /** The passport is gone: the list drops the row and the dashboard comes back. */
    onDeleted: (passportId: string) => void;
    onLookupUser: (uid: string) => void;
    showToast: ShowToast;
    readOnly: boolean;
}

/**
 * One passport's page: who holds it, its sticker, and its permanent audit
 * trail.
 *
 * Any passport's key slip can be viewed. Stock that has never been sold can have
 * its slip reissued or be deleted outright.
 *
 * A claimed passport can only be deleted here, one at a time — the stock table's
 * bulk delete refuses claimed rows, so unbinding one is always a deliberate act
 * taken with the holder named on the screen. Deleting it doesn't take back the
 * membership the claim granted; that is adjusted through the user's membership
 * row, as it always was.
 */
export const PassportDetail = ({
                                   passportId,
                                   initial,
                                   onBack,
                                   onChanged,
                                   onDeleted,
                                   onLookupUser,
                                   showToast,
                                   readOnly,
                               }: PassportDetailProps) => {
    const {isEnglish} = useLanguage();
    const {designs} = usePassportDesigns();
    const [passport, setPassport] = useState<Passport | null>(initial);
    const [missing, setMissing] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [owner, setOwner] = useState<UserRecord | null>(null);
    const [ownerMissing, setOwnerMissing] = useState(false);
    const [claims, setClaims] = useState<PassportClaimEvent[] | null>(null);
    const [busy, setBusy] = useState(false);
    // Fetched on the first Show, since every fetch is logged on the passport's
    // trail. Hide only masks it, so showing it again isn't a second look.
    const [key, setKey] = useState<string | null>(null);
    const [keyShown, setKeyShown] = useState(false);

    const {request: requestPng, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR code.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = passportScanUrl(passportId, origin);

    // Absent and unreadable are different answers: "not found" is only ever shown
    // for a passport the server confirmed isn't there, never for a failed read.
    const reload = useCallback(async () => {
        const fresh = await fetchPassport(passportId);
        setPassport(fresh);
        setMissing(fresh === null);
        setLoadFailed(false);
        return fresh;
    }, [passportId]);

    useEffect(() => {
        void reload().catch(() => setLoadFailed(true));
    }, [reload]);

    // Staff (read-only) can't read the claims subcollection — core-staff+ only —
    // so the request isn't made rather than failing visibly. A reissue and a key
    // view both write to this trail, and call it again once they land.
    const claimsToken = useRef(0);
    const loadClaims = useCallback(() => {
        if (readOnly) return;
        const token = ++claimsToken.current;
        fetchPassportClaims(passportId)
            .then(list => {
                if (token === claimsToken.current) setClaims(list);
            })
            .catch(() => {
                if (token === claimsToken.current) setClaims([]);
            });
    }, [passportId, readOnly]);

    useEffect(loadClaims, [loadClaims]);

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

    /**
     * What a reissue or a key view leaves behind: a changed passport the list is
     * still holding the old copy of, and a new entry in the audit trail the
     * History section exists to show. Failing here is a stale screen, never a
     * failed action — the write it follows has already committed.
     */
    const refreshAfterWrite = async () => {
        try {
            const fresh = await reload();
            if (fresh) onChanged(fresh);
        } catch {
            setLoadFailed(true);
        }
        loadClaims();
    };

    const fmtDate = (date: Date | null): string =>
        passportDateTime(date, isEnglish, isEnglish ? 'Never' : '从未');

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue)
            .then(() => showToast(isEnglish ? 'Link copied.' : '链接已复制。', 'success'))
            .catch(() => showToast(isEnglish ? 'Failed to copy.' : '复制失败。', 'error'));
    };

    const deleteStock = async () => {
        if (!window.confirm(isEnglish
            ? `Delete passport ${passportId}? The passport, its activation key and its history are all removed, and its sticker stops working. This can't be undone. Use it for stock that was destroyed or mispacked.`
            : `删除通行证 ${passportId}？该通行证及其激活码、历史记录都将被移除，贴纸随之失效。此操作无法撤销。请仅对已损毁或错误包装的库存使用。`)) return;
        setBusy(true);
        let result;
        try {
            result = (await callDeletePassports({passportIds: [passportId]})).data;
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete passport.' : '删除通行证失败。'), 'error');
            setBusy(false);
            return;
        }
        // The call reports a skip rather than failing, so a passport claimed or
        // already deleted under this open page says so here instead of vanishing
        // from a list it is still in.
        if (result.deleted.length === 0) {
            showToast(
                result.claimed.length > 0
                    ? (isEnglish
                        ? 'This passport has just been claimed, so it can no longer be deleted.'
                        : '此通行证刚刚被激活，已无法删除。')
                    : (isEnglish ? 'This passport no longer exists.' : '此通行证已不存在。'),
                'error',
            );
            setBusy(false);
            await refreshAfterWrite();
            return;
        }
        // Nothing left to refetch: the page goes back to the list, which drops the
        // row rather than re-reading the design.
        showToast(isEnglish ? 'Passport deleted.' : '通行证已删除。', 'warning');
        onDeleted(passportId);
    };

    /**
     * Break a permanent binding and remove the passport with it — a passport
     * activated by mistake, or onto the wrong account, which no membership edit
     * can put right.
     *
     * Reached from this page only. The bulk delete in the stock table skips
     * claimed rows entirely, so this is never something a ticked selection can do
     * by accident: whoever deletes a member's passport has opened it and read the
     * Holder above the button first, which is why the name goes in the question.
     *
     * The server answers not-found or a failed precondition rather than reporting
     * a skip — one passport, one outcome — so unlike the stock delete there is no
     * "nothing went" case to explain here.
     */
    const deleteClaimed = async () => {
        const holder = owner?.displayName
            || (ownerMissing ? (isEnglish ? 'a deleted account' : '一个已删除的账号') : '');
        const held = holder ? (isEnglish ? `, held by ${holder}` : `（持有者：${holder}）`) : '';
        if (!window.confirm(isEnglish
            ? `Delete passport ${passportId}${held}? It leaves the holder's shelf, its sticker stops working, and its activation key and history go with it. This can't be undone. The membership the activation granted is not taken back — adjust that in Users Management.`
            : `删除通行证 ${passportId}${held}？该通行证将从持有者的书架上消失，贴纸随之失效，激活码与历史记录一并移除。此操作无法撤销。激活时授予的会员资格不会被收回 — 如需调整请前往用户管理。`)) return;
        setBusy(true);
        try {
            await callDeleteClaimedPassport({passportId});
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete passport.' : '删除通行证失败。'), 'error');
            setBusy(false);
            return;
        }
        showToast(isEnglish ? 'Passport deleted.' : '通行证已删除。', 'warning');
        onDeleted(passportId);
    };

    const toggleKey = async () => {
        if (keyShown || key) {
            setKeyShown(!keyShown);
            return;
        }
        setBusy(true);
        try {
            const res = await callRevealPassportKey({passportId});
            setKey(res.data.activationCode);
            setKeyShown(true);
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to load the key.' : '加载激活码失败。'), 'error');
            setBusy(false);
            return;
        }
        setBusy(false);
        // The look itself is now on the trail.
        loadClaims();
    };

    const reissueKey = async () => {
        if (!window.confirm(isEnglish
            ? `Issue a new activation key for ${passportId}? The key on the current slip stops working immediately — print the replacement slip before packing it. If the slip was only lost, use Show key instead.`
            : `为 ${passportId} 签发新的激活码？当前纸条上的激活码将立即失效 — 请在装袋前打印新的纸条。如果只是纸条丢失，请改用“显示激活码”。`)) return;
        setBusy(true);
        try {
            const res = await callReissuePassportKey({passportId});
            // Shown straight away: the admin asked for it in order to print it.
            setKey(res.data.activationCode);
            setKeyShown(true);
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to reissue the key.' : '重新签发激活码失败。'), 'error');
            setBusy(false);
            return;
        }
        showToast(isEnglish ? 'New activation key issued.' : '已签发新的激活码。', 'success');
        await refreshAfterWrite();
        setBusy(false);
    };

    // "Not found" is reserved for a read that came back empty. A read that never
    // came back says so instead, so a network blip can't retire a live passport.
    if (missing || (loadFailed && !passport)) {
        return (
            <div className="admin-section">
                <div className="admin-tools-back-row">
                    <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                        {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                    </button>
                </div>
                <p className="admin-no-results">
                    {missing
                        ? (isEnglish ? 'Passport not found.' : '未找到通行证。')
                        : (isEnglish ? 'Failed to load this passport.' : '加载此通行证失败。')}
                </p>
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

    const locked = !!passport.lockedUntil && passport.lockedUntil.getTime() > Date.now();
    const unclaimed = passport.status === 'unclaimed';
    const keyViewable = !readOnly;

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
                    {passportName(designs.find(d => d.id === passport.designId), isEnglish)}
                </p>
                {loadFailed && (
                    <p className="admin-helper-text admin-field-hint">
                        {isEnglish
                            ? 'Couldn’t refresh — the details below may be out of date.'
                            : '刷新失败 — 以下信息可能不是最新的。'}
                    </p>
                )}
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
                        {passport.claimedAt && (
                            <div>
                                <dt>{isEnglish ? 'Activated' : '激活时间'}</dt>
                                <dd>{fmtDate(passport.claimedAt)}</dd>
                            </div>
                        )}
                        <div>
                            <dt>{isEnglish ? 'Term' : '有效期'}</dt>
                            <dd>{isEnglish ? `${passport.termDays} days` : `${passport.termDays} 天`}</dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Generated' : '生成时间'}</dt>
                            <dd>
                                {fmtDate(passport.createdAt)}
                                {passport.createdByName && ` · ${passport.createdByName}`}
                            </dd>
                        </div>
                        <div>
                            <dt>
                                {isEnglish ? 'Key slip' : '激活码纸条'}
                                {keyViewable && (
                                    <button
                                        type="button"
                                        className="admin-qr-row-edit"
                                        onClick={() => void toggleKey()}
                                        disabled={busy}
                                    >
                                        {keyShown
                                            ? (isEnglish ? 'Hide key' : '隐藏激活码')
                                            : (isEnglish ? 'Show key' : '显示激活码')}
                                    </button>
                                )}
                            </dt>
                            <dd>
                                {passport.status === 'claimed'
                                    ? (isEnglish ? 'Spent on activation' : '已在激活时使用')
                                    : (isEnglish
                                        ? `Issued ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · reissued ${passport.keyReissueCount}×` : ''}`
                                        : `签发于 ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · 已重新签发 ${passport.keyReissueCount} 次` : ''}`)}
                                {keyViewable && (keyShown && key ? (
                                    <div className="admin-passport-key-secret">{key}</div>
                                ) : (
                                    <div className="admin-passport-key-secret admin-passport-key-secret--masked">
                                        {MASKED_KEY}
                                    </div>
                                ))}
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

            {!readOnly && (
                <div className="admin-field-section admin-qr-section">
                    <div className="admin-qr-spot-header">
                        <span className="admin-field-label">{isEnglish ? 'History' : '历史记录'}</span>
                    </div>
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
                        onClick={() => void deleteStock()}
                        disabled={busy}
                    >
                        {isEnglish ? 'Delete passport' : '删除通行证'}
                    </button>
                </div>
            )}
            {!readOnly && passport.status === 'claimed' && (
                <>
                    <p className="admin-helper-text admin-passport-bound-note">
                        {isEnglish
                            ? 'A claimed passport is permanently bound to its holder — it can’t be rebound to another account, and no bulk delete will touch it. Deleting it below is the only way out of that binding: the passport goes for good rather than returning to stock, and the membership it granted stays as it is. Adjust that membership in Users Management.'
                            : '已激活的通行证与持有者永久绑定 — 无法转绑到其他账号，也不会被批量删除影响。下方的删除是解除绑定的唯一方式：通行证将被彻底移除，而非退回库存，且其授予的会员资格保持不变。如需调整该会员资格，请前往用户管理。'}
                    </p>
                    <div className="admin-qr-danger-row">
                        <button
                            className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                            onClick={() => void deleteClaimed()}
                            disabled={busy}
                        >
                            {isEnglish ? 'Delete passport' : '删除通行证'}
                        </button>
                    </div>
                </>
            )}
            {pngNode}
        </div>
    );
};

const actionLabel = (action: PassportClaimEvent['action'], isEnglish: boolean): string => {
    if (action === 'key-reissue') return isEnglish ? 'Key' : '激活码';
    if (action === 'key-view') return isEnglish ? 'Viewed' : '查看';
    return isEnglish ? 'Claim' : '激活';
};
