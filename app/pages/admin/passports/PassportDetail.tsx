import { useCallback, useEffect, useState } from 'react';
import { FaExternalLinkAlt } from 'react-icons/fa';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteClaimedPassport,
    callDeletePassports,
    callReissuePassportKey,
    callRevealPassportKey,
    errorMessage,
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
import { addSiteDays, formatSiteTime } from '~/lib/siteTime';
import { QrPreview } from '../tools/qr/qrExport';
import type { UserRecord } from '../types';
import { UserAvatar } from '../UserRow';
import { docToUserRecord, type ShowToast } from '../utils';
import { usePassportPngExport } from './passportExport';
import { PassportPageTag } from './PassportSearch';

const QR_SIZE = 200;
const MASKED_KEY = '••••-••••-••••';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What subtracting a passport's term would leave, for the line under the
 * checkbox. Mirrors reducedExpiry in functions/src/utils/membership.ts, which
 * decides; the toast reports what it actually took. Null when there's nothing to
 * take.
 */
const previewReduced = (current: Date | null, days: number): {expiresAt: Date; daysRemoved: number} | null => {
    if (!current) return null;
    const now = Date.now();
    if (current.getTime() <= now) return null;
    const floored = Math.max(now, addSiteDays(current.getTime(), -days));
    return {
        expiresAt: new Date(floored),
        // Rounded, as a day across a DST change is 23 or 25 hours.
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
 * One passport's page: who holds it and its sticker. Any passport's key can be
 * viewed; unsold stock can have its slip reissued or be deleted.
 *
 * A claimed passport can only be deleted here, with its holder on screen (the
 * stock table can't tick claimed rows). The delete panel's one choice is whether
 * the claim's days come back off the holder's membership, floored at today.
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
    // So a failed read never says the account was deleted.
    const [ownerMissing, setOwnerMissing] = useState(false);
    const [ownerFailed, setOwnerFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    // Fetched on the first Show, since every fetch is recorded; Hide only masks
    // it.
    const [key, setKey] = useState<string | null>(null);
    const [keyShown, setKeyShown] = useState(false);
    // A panel rather than window.confirm, since it carries a choice and shows
    // its result.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [subtractDays, setSubtractDays] = useState(false);

    const {request: requestPng, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR code.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = passportScanUrl(passportId, origin);

    // "Not found" only for a passport the server confirmed missing, never a
    // failed read.
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
        setOwner(null);
        setOwnerMissing(false);
        setOwnerFailed(false);
        if (!ownerUid) return;
        let stale = false;
        getDoc(doc(getFirebaseDb(), 'users', ownerUid))
            .then(snap => {
                if (stale) return;
                if (snap.exists()) setOwner(docToUserRecord(snap));
                else setOwnerMissing(true);
            })
            .catch(() => {
                if (!stale) setOwnerFailed(true);
            });
        return () => {
            stale = true;
        };
    }, [ownerUid]);

    /**
     * Updates the list's copy after a reissue. A failure here is a stale screen;
     * the write has committed.
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
    // Expiries are set on the Pacific clock; issue, claim and creation dates
    // are moments, shown in the viewer's zone.
    const fmtExpiry = (date: Date | null): string => date
        ? formatSiteTime(date, isEnglish, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : (isEnglish ? 'Never' : '从未');

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
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to delete passport.' : '删除通行证失败。'), 'error');
            setBusy(false);
            return;
        }
        // Claimed or deleted under this open page: the call reports a skip, said
        // here.
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
        // The list drops the row itself.
        showToast(isEnglish ? 'Passport deleted.' : '通行证已删除。', 'warning');
        onDeleted(passportId);
    };

    /**
     * Break a permanent binding and remove the passport, for one activated by
     * mistake or onto the wrong account.
     *
     * Only from this page, since the stock table can't tick claimed rows. The
     * panel that calls this is the confirmation. The server answers not-found or
     * failed-precondition rather than a skip, so there's no "nothing went" case.
     */
    const deleteClaimed = async () => {
        setBusy(true);
        let result;
        try {
            result = (await callDeleteClaimedPassport({passportId, subtractDays})).data;
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to delete passport.' : '删除通行证失败。'), 'error');
            setBusy(false);
            return;
        }
        // What the server took, not the preview: the membership may have moved
        // meanwhile.
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
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to load the key.' : '加载激活码失败。'), 'error');
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
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to reissue the key.' : '重新签发激活码失败。'), 'error');
            setBusy(false);
            return;
        }
        showToast(isEnglish ? 'New activation key issued.' : '已签发新的激活码。', 'success');
        await refreshAfterWrite();
        setBusy(false);
    };

    // "Not found" only for an empty read; a failed one says so, so a network
    // blip can't retire a live passport.
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

    const unclaimed = passport.status === 'unclaimed';
    const keyViewable = !readOnly;
    // Null while the holder loads or can't be read, for a deleted account, and
    // for a lapsed membership; the box stays off and the line below says why.
    const reduction = previewReduced(owner?.membershipExpiresAt ?? null, passport.termDays);
    const ownerLoading = !owner && !ownerMissing && !ownerFailed;

    /** The line under the checkbox: what the box as it stands would leave behind. */
    const deleteEffect = (): string => {
        if (ownerLoading) {
            return isEnglish ? 'Checking the holder’s membership…' : '正在读取持有者的会员资格…';
        }
        if (ownerFailed) {
            return isEnglish
                ? 'The holder’s membership couldn’t be read. To take days back, go back and open this passport again.'
                : '无法读取持有者的会员资格。如需收回天数，请返回后重新打开此通行证。';
        }
        if (!reduction) {
            return isEnglish
                ? 'There are no membership days left to take back — the holder’s membership has already run out, or their account is gone.'
                : '没有可收回的会员天数 — 持有者的会员资格已到期，或其账号已删除。';
        }
        const from = fmtExpiry(owner?.membershipExpiresAt ?? null);
        if (!subtractDays) {
            return isEnglish
                ? `Left off, the membership keeps its current expiry of ${from}.`
                : `不勾选时，会员资格保持当前到期日 ${from}。`;
        }
        // Fewer days left than it gave: say the floor applied, rather than
        // silently clamp.
        if (reduction.daysRemoved < passport.termDays) {
            return isEnglish
                ? `Only ${reduction.daysRemoved} ${reduction.daysRemoved === 1 ? 'day is' : 'days are'} left to take, so the membership ends today rather than going negative.`
                : `仅剩 ${reduction.daysRemoved} 天可收回，因此会员资格将于今日结束，而不会变为负数。`;
        }
        return isEnglish
            ? `Membership expiry moves from ${from} to ${fmtExpiry(reduction.expiresAt)}.`
            : `会员到期日将从 ${from} 变更为 ${fmtExpiry(reduction.expiresAt)}。`;
    };

    const design = designs.find(d => d.id === passport.designId);
    const designName = passportName(design, isEnglish);

    /** The holder card's body — the one fact the page is mostly opened for. */
    const holderBody = () => {
        if (unclaimed) {
            return (
                <div className="admin-passport-holder-empty">
                    <p className="admin-passport-holder-empty-title">
                        {isEnglish ? 'Not activated yet' : '尚未激活'}
                    </p>
                    <p className="admin-passport-holder-empty-note">
                        {isEnglish
                            ? 'This one is still stock. Whoever enters its key binds it to their account for good — there is no unbind.'
                            : '此通行证仍是库存。输入激活码的账号将与其永久绑定 — 无法解绑。'}
                    </p>
                </div>
            );
        }
        if (owner) {
            const membership = owner.membershipExpiresAt;
            const active = !!membership && membership.getTime() > Date.now();
            return (
                <button
                    type="button"
                    className="admin-passport-holder-card"
                    onClick={() => onLookupUser(owner.uid)}
                >
                    <UserAvatar photoURL={owner.photoURL} displayName={owner.displayName}/>
                    <span className="admin-passport-holder-lines">
                        <span className="admin-passport-holder-display">{owner.displayName}</span>
                        <span className="admin-passport-holder-mail">{owner.email}</span>
                        <span
                            className={`admin-passport-holder-member${active ? '' : ' admin-passport-holder-member--lapsed'}`}>
                            {active
                                ? (isEnglish
                                    ? `Member until ${fmtExpiry(membership)}`
                                    : `会员资格至 ${fmtExpiry(membership)}`)
                                : membership
                                    ? (isEnglish
                                        ? `Membership ran out ${fmtExpiry(membership)}`
                                        : `会员资格已于 ${fmtExpiry(membership)} 到期`)
                                    : (isEnglish ? 'No membership on file' : '无会员资格记录')}
                        </span>
                    </span>
                    <span className="admin-passport-holder-go">
                        {isEnglish ? 'Open in Users →' : '在用户管理中打开 →'}
                    </span>
                </button>
            );
        }
        if (ownerMissing) {
            return (
                <div className="admin-passport-holder-empty">
                    <p className="admin-passport-holder-empty-title">
                        {isEnglish ? 'Account deleted' : '账号已删除'}
                    </p>
                    <p className="admin-passport-holder-empty-note">
                        {isEnglish
                            ? 'The passport stays bound to it, and its public page no longer resolves.'
                            : '通行证仍与该账号保持绑定，其公开页面不再显示。'}
                    </p>
                </div>
            );
        }
        if (ownerFailed) {
            return (
                <div className="admin-passport-holder-empty">
                    <p className="admin-passport-holder-empty-title">
                        {isEnglish ? 'Couldn’t load the holder' : '无法加载持有者'}
                    </p>
                    <p className="admin-passport-holder-empty-note">
                        {isEnglish
                            ? 'The passport is still bound to their account. Go back and open it again to retry.'
                            : '通行证仍与其账号绑定。请返回后重新打开以重试。'}
                    </p>
                </div>
            );
        }
        return <div className="admin-passport-holder-empty"><span className="spinner"/></div>;
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-back-row">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
            </div>

            {/* The passport itself: cover, printed code and its state. */}
            <header className={`admin-passport-hero admin-passport-hero--${passport.status}`}>
                <div className="admin-passport-hero-cover">
                    {design?.coverImageUrl
                        ? <img src={design.coverImageUrl} alt=""/>
                        : <span>{passport.year || '—'}</span>}
                </div>
                <div className="admin-passport-hero-text">
                    <p className="admin-passport-hero-design">
                        {designName
                            ? `${passport.year} · ${designName}`
                            : (passport.year || '')}
                    </p>
                    <h3 className="admin-passport-hero-code">{passport.id}</h3>
                    <p className="admin-passport-hero-term">
                        {isEnglish
                            ? `${passport.termDays}-day membership term`
                            : `${passport.termDays} 天会员期限`}
                    </p>
                </div>
                <div className="admin-passport-hero-badges">
                    <span className={`admin-qr-badge admin-qr-badge-lg admin-passport-badge--${passport.status}`}>
                        {passportStatusLabel(passport.status, isEnglish)}
                    </span>
                    {/* The holder's setting, so only once they've loaded. */}
                    {!unclaimed && owner && <PassportPageTag hidden={owner.hidePassportPage}/>}
                    {/* What a scan of the sticker opens, in a new tab. */}
                    <a
                        href={scanValue}
                        target="_blank"
                        rel="noreferrer"
                        className="admin-toggle-btn admin-toggle-edit admin-passport-hero-open"
                    >
                        <FaExternalLinkAlt aria-hidden="true"/>
                        {isEnglish ? 'Open passport page' : '打开通行证页面'}
                    </a>
                </div>
            </header>

            {loadFailed && (
                <p className="admin-passport-stale">
                    {isEnglish
                        ? 'Couldn’t refresh — the details below may be out of date.'
                        : '刷新失败 — 以下信息可能不是最新的。'}
                </p>
            )}

            <div className="admin-passport-detail-grid">
                <div className="admin-passport-detail-main">
                    <section className="admin-passport-panel">
                        <h4 className="admin-passport-panel-title">
                            {isEnglish ? 'Holder' : '持有者'}
                        </h4>
                        {holderBody()}
                    </section>

                    {/* The slip that ships in the bag, with the one action that
                        touches it. */}
                    <section className="admin-passport-panel">
                        <div className="admin-passport-panel-head">
                            <h4 className="admin-passport-panel-title">
                                {isEnglish ? 'Key slip' : '激活码纸条'}
                            </h4>
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
                        </div>
                        {/* Only for someone who can reveal it. */}
                        {keyViewable && (
                            <div className={`admin-passport-key-readout${
                                keyShown && key ? '' : ' admin-passport-key-readout--masked'}`}>
                                {keyShown && key ? key : MASKED_KEY}
                            </div>
                        )}
                        <p className="admin-passport-key-meta">
                            {passport.status === 'claimed'
                                ? (isEnglish ? 'Spent on activation' : '已在激活时使用')
                                : (isEnglish
                                    ? `Issued ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · reissued ${passport.keyReissueCount}×` : ''}`
                                    : `签发于 ${fmtDate(passport.keyIssuedAt)}${passport.keyReissueCount > 0 ? ` · 已重新签发 ${passport.keyReissueCount} 次` : ''}`)}
                        </p>
                        {!readOnly && unclaimed && (
                            <div className="admin-passport-panel-foot">
                                <button
                                    className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                    onClick={() => void reissueKey()}
                                    disabled={busy}
                                    type="button"
                                >
                                    {isEnglish ? 'Reissue key slip' : '重新签发纸条'}
                                </button>
                                <span className="admin-passport-panel-foot-note">
                                    {isEnglish
                                        ? 'Retires the printed key and mints a new one.'
                                        : '作废已印刷的激活码并生成新的。'}
                                </span>
                            </div>
                        )}
                    </section>

                    <section className="admin-passport-panel">
                        <h4 className="admin-passport-panel-title">
                            {isEnglish ? 'Record' : '记录'}
                        </h4>
                        <dl className="admin-passport-facts">
                            <div>
                                {/* What activating it awarded, fixed at
                                    generation; the passport itself never
                                    expires. */}
                                <dt>{isEnglish ? 'Grants' : '授予'}</dt>
                                <dd>
                                    {isEnglish
                                        ? `${passport.termDays} days of membership`
                                        : `${passport.termDays} 天会员资格`}
                                </dd>
                            </div>
                            {passport.claimedAt && (
                                <div>
                                    <dt>{isEnglish ? 'Activated' : '激活时间'}</dt>
                                    <dd>{fmtDate(passport.claimedAt)}</dd>
                                </div>
                            )}
                            {/* Sent by email rather than printed. */}
                            {passport.sentTo && (
                                <div>
                                    <dt>{isEnglish ? 'Emailed to' : '发送至'}</dt>
                                    <dd>
                                        {passport.sentTo}
                                        <span className="admin-passport-fact-by">
                                            {passport.emailScheduled
                                                ? (isEnglish ? 'Queued' : '排队中')
                                                : fmtDate(passport.emailSentAt)}
                                        </span>
                                    </dd>
                                </div>
                            )}
                            <div>
                                <dt>{isEnglish ? 'Generated' : '生成时间'}</dt>
                                <dd>
                                    {fmtDate(passport.createdAt)}
                                    {passport.createdByName && (
                                        <span className="admin-passport-fact-by">
                                            {passport.createdByName}
                                        </span>
                                    )}
                                </dd>
                            </div>
                        </dl>
                    </section>
                </div>

                {/* The printed side: what the sticker shows, where it points,
                    and its artwork. */}
                <aside className="admin-passport-panel admin-passport-sticker">
                    <h4 className="admin-passport-panel-title">
                        {isEnglish ? 'Sticker' : '贴纸'}
                    </h4>
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
                        className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                        onClick={() => requestPng([passport.id], `passport-${passport.id}`)}
                        type="button"
                    >
                        {isEnglish ? 'Download sticker PNG' : '下载贴纸 PNG'}
                    </button>
                </aside>
            </div>

            {/* Everything that can't be undone, in one place. */}
            {!readOnly && (
                <section className={`admin-passport-danger${
                    confirmingDelete ? ' admin-passport-danger--open' : ''}`}>
                    <h4 className="admin-passport-danger-title">
                        {isEnglish ? 'Danger zone' : '危险操作'}
                    </h4>
                    {!confirmingDelete ? (
                        <div className="admin-passport-danger-row">
                            <p className="admin-passport-danger-note">
                                {unclaimed
                                    ? (isEnglish
                                        ? 'Removes this passport and its key. For stock that was destroyed or mispacked.'
                                        : '移除该通行证及其激活码。适用于已损毁或错误包装的库存。')
                                    : (isEnglish
                                        ? 'Breaks a permanent binding. For a passport activated by mistake, or onto the wrong account.'
                                        : '解除永久绑定。适用于误激活或激活到错误账号的通行证。')}
                            </p>
                            <button
                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                onClick={() => {
                                    if (unclaimed) {
                                        void deleteStock();
                                        return;
                                    }
                                    // Off every time it opens: taking days back is
                                    // decided per passport.
                                    setSubtractDays(false);
                                    setConfirmingDelete(true);
                                }}
                                disabled={busy}
                                type="button"
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
                    )}
                </section>
            )}
            {pngNode}
        </div>
    );
};
