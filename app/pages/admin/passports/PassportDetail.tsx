import { useCallback, useEffect, useState } from 'react';
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
    type Passport,
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
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What subtracting a passport's term would leave of a membership, for the line
 * under the checkbox. Mirrors reducedExpiry in
 * functions/src/utils/membership.ts, which is the one that decides: this only has
 * to be right enough to answer "what am I about to do", and the toast afterwards
 * reports what the server actually took.
 *
 * Null means there is nothing to take — no membership on file, or one that has
 * already run out.
 */
const previewReduced = (current: Date | null, days: number): {expiresAt: Date; daysRemoved: number} | null => {
    if (!current) return null;
    const now = Date.now();
    if (current.getTime() <= now) return null;
    const floored = Math.max(now, current.getTime() - days * DAY_MS);
    return {
        expiresAt: new Date(floored),
        daysRemoved: Math.round((current.getTime() - floored) / DAY_MS),
    };
};

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
 * One passport's page: who holds it and its sticker.
 *
 * Any passport's key slip can be viewed. Stock that has never been sold can have
 * its slip reissued or be deleted outright.
 *
 * A claimed passport can only be deleted here, one at a time — the stock table
 * won't even let a claimed row be ticked, so unbinding one is always a deliberate
 * act taken with the holder on the screen. The delete panel carries the one
 * choice that goes with it: whether the days the claim granted come back off the
 * holder's membership, floored at today so it can never go negative. Left off,
 * the membership isn't touched, and any other change to it belongs in Users
 * Management.
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
    const [busy, setBusy] = useState(false);
    // Fetched on the first Show, since every fetch is written to the Records tab.
    // Hide only masks it, so showing it again isn't a second look.
    const [key, setKey] = useState<string | null>(null);
    const [keyShown, setKeyShown] = useState(false);
    // The claimed passport's delete is a panel rather than a window.confirm,
    // because it carries a choice — and the membership it would leave behind —
    // which a confirm can't show. Kept shut until asked for.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [subtractDays, setSubtractDays] = useState(false);

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
     * What a reissue leaves behind: a changed passport the list is still holding
     * the old copy of. Failing here is a stale screen, never a failed action — the
     * write it follows has already committed.
     */
    const refreshAfterWrite = async () => {
        try {
            const fresh = await reload();
            if (fresh) onChanged(fresh);
        } catch {
            setLoadFailed(true);
        }
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
            ? `Delete passport ${passportId}? The passport and its activation key are both removed, and its sticker stops working. This can't be undone. Use it for stock that was destroyed or mispacked.`
            : `删除通行证 ${passportId}？该通行证及其激活码都将被移除，贴纸随之失效。此操作无法撤销。请仅对已损毁或错误包装的库存使用。`)) return;
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
     * Reached from this page only. The bulk delete in the stock table can't even
     * tick a claimed row, so this is never something a selection can do by
     * accident: whoever deletes a member's passport has opened it and read the
     * Holder above the button first.
     *
     * The panel that calls this is the confirmation — it states the consequences,
     * carries the membership choice, and shows what that choice would leave — so
     * there is no window.confirm on top of it.
     *
     * The server answers not-found or a failed precondition rather than reporting
     * a skip — one passport, one outcome — so unlike the stock delete there is no
     * "nothing went" case to explain here.
     */
    const deleteClaimed = async () => {
        setBusy(true);
        let result;
        try {
            result = (await callDeleteClaimedPassport({passportId, subtractDays})).data;
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete passport.' : '删除通行证失败。'), 'error');
            setBusy(false);
            return;
        }
        // What the server actually took, not what the panel predicted: the
        // membership may have moved under the open page, and days asked for can
        // come back as none.
        showToast(
            result.daysRemoved > 0
                ? (isEnglish
                    ? `Passport deleted and ${result.daysRemoved} ${result.daysRemoved === 1 ? 'day' : 'days'} taken off the membership.`
                    : `通行证已删除，并从会员期限中收回 ${result.daysRemoved} 天。`)
                : result.nothingToSubtract
                    ? (isEnglish
                        ? 'Passport deleted. There were no membership days left to take back.'
                        : '通行证已删除。没有可收回的会员天数。')
                    : (isEnglish ? 'Passport deleted.' : '通行证已删除。'),
            'warning',
        );
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
    // What ticking the box would do. Null while the holder is still loading, for
    // an account that is gone, and for a membership that has already run out —
    // none of the three has days to give back, so the box stays off for all of
    // them, and the line below says which it is.
    const reduction = previewReduced(owner?.membershipExpiresAt ?? null, passport.termDays);
    const ownerLoading = !owner && !ownerMissing;

    /** The line under the checkbox: what the box as it stands would leave behind. */
    const deleteEffect = (): string => {
        if (ownerLoading) {
            return isEnglish ? 'Checking the holder’s membership…' : '正在读取持有者的会员资格…';
        }
        if (!reduction) {
            return isEnglish
                ? 'There are no membership days left to take back — the holder’s membership has already run out, or their account is gone.'
                : '没有可收回的会员天数 — 持有者的会员资格已到期，或其账号已删除。';
        }
        const from = fmtDate(owner?.membershipExpiresAt ?? null);
        if (!subtractDays) {
            return isEnglish
                ? `Left off, the membership keeps its current expiry of ${from}.`
                : `不勾选时，会员资格保持当前到期日 ${from}。`;
        }
        // Fewer days left than the passport gave: the floor is doing the work, and
        // saying so is the difference between a clamp and a silent wrong answer.
        if (reduction.daysRemoved < passport.termDays) {
            return isEnglish
                ? `Only ${reduction.daysRemoved} ${reduction.daysRemoved === 1 ? 'day is' : 'days are'} left to take, so the membership ends today rather than going negative.`
                : `仅剩 ${reduction.daysRemoved} 天可收回，因此会员资格将于今日结束，而不会变为负数。`;
        }
        return isEnglish
            ? `Membership expiry moves from ${from} to ${fmtDate(reduction.expiresAt)}.`
            : `会员到期日将从 ${from} 变更为 ${fmtDate(reduction.expiresAt)}。`;
    };

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
                            {/* Not a lifetime: a passport never expires. This
                                is what activating it awarded, fixed when the
                                passport was generated. */}
                            <dt>{isEnglish ? 'Grants' : '授予'}</dt>
                            <dd>
                                {isEnglish
                                    ? `${passport.termDays} days of membership`
                                    : `${passport.termDays} 天会员资格`}
                            </dd>
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
                !confirmingDelete ? (
                    <div className="admin-qr-danger-row">
                        <button
                            className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                            onClick={() => {
                                // Off every time it opens: taking days back is
                                // its own decision, not the one carried over
                                // from the last passport.
                                setSubtractDays(false);
                                setConfirmingDelete(true);
                            }}
                        >
                            {isEnglish ? 'Delete passport' : '删除通行证'}
                        </button>
                    </div>
                ) : (
                    <div
                        className="admin-passport-warning admin-passport-warning--urgent admin-passport-delete-panel">
                        <strong>
                            {isEnglish
                                ? `Delete passport ${passport.id}?`
                                : `删除通行证 ${passport.id}？`}
                        </strong>
                        <p>
                            {isEnglish
                                ? `It leaves ${owner?.displayName || 'the holder'}’s shelf, its sticker stops working, and its activation key goes with it. This can’t be undone.`
                                : `该通行证将从${owner?.displayName || '持有者'}的书架上消失，贴纸随之失效，激活码一并移除。此操作无法撤销。`}
                        </p>

                        <label className="admin-checkbox-label admin-passport-delete-choice">
                            <input
                                type="checkbox"
                                checked={subtractDays}
                                onChange={e => setSubtractDays(e.target.checked)}
                                disabled={busy || !reduction}
                            />
                            <span>
                                {isEnglish
                                    ? `Also take back the ${passport.termDays} days it granted`
                                    : `同时收回其授予的 ${passport.termDays} 天会员资格`}
                            </span>
                        </label>
                        <p className="admin-passport-delete-effect">{deleteEffect()}</p>

                        <div className="admin-btn-row">
                            <button
                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                onClick={() => void deleteClaimed()}
                                disabled={busy}
                                type="button"
                            >
                                {busy
                                    ? (isEnglish ? 'Deleting…' : '删除中…')
                                    : (isEnglish ? 'Delete passport' : '删除通行证')}
                            </button>
                            <button
                                className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                                onClick={() => setConfirmingDelete(false)}
                                disabled={busy}
                                type="button"
                            >
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </div>
                )
            )}
            {pngNode}
        </div>
    );
};
