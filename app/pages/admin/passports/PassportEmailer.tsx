import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callEmailPassports, callGetTicketEmailQuota, errorSuffix, functionsErrorCode } from '~/lib/firebase';
import { fetchPassportsByDesign, MAX_PASSPORT_EMAIL, type PassportDesign } from '~/lib/passports';
import { confirmExit, useExitGuard } from '~/lib/useExitGuard';
import { parseFile } from '../tickets/importValidation';
import type { ShowToast } from '../utils';
import { PassportEmailTemplateSection } from './PassportEmailTemplateSection';
import { designLabel, DesignSelect, DesignTermHint } from './PassportGenerator';
import { countAddresses, parseEmailList } from './passportEmail';

interface PassportEmailerProps {
    designs: PassportDesign[];
    defaultDesignId: string | null;
    onBack: () => void;
    showToast: ShowToast;
}

interface QuotaState {
    sentToday: number;
    dailyCap: number;
    queuedCount: number;
    queueCap: number;
}

/** What one run came to, across its chunks. */
interface RunResult {
    sent: number;
    queued: number;
    /** Not sent, and put back in the list: no room, refused, or never reached. */
    left: number;
}

/** How many of an address's repeats a notice names before counting the rest. */
const NAMED_MAX = 10;

/** "a@x.com ×2, b@y.com ×3", the first NAMED_MAX, then how many more. */
const nameAddresses = (entries: [string, number][], isEnglish: boolean): string => {
    const named = entries.slice(0, NAMED_MAX).map(([email, n]) => `${email} ×${n}`).join(isEnglish ? ', ' : '、');
    const more = entries.length - NAMED_MAX;
    return more > 0 ? (isEnglish ? `${named} and ${more} more` : `${named} 等另外 ${more} 个`) : named;
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Passports sent by email: a list of addresses, pasted or imported, each sent
 * a passport of its own from one design, with its key in the email edited
 * below. An address listed twice gets two, for someone who bought two, so
 * repeats, and anyone already sent one of the design, are pointed out rather
 * than dropped. Whatever doesn't go is put back in the list, so sending it
 * again picks up where this run stopped.
 */
export const PassportEmailer = ({designs, defaultDesignId, onBack, showToast}: PassportEmailerProps) => {
    const {isEnglish} = useLanguage();
    const [designId, setDesignId] = useState(defaultDesignId ?? designs[0]?.id ?? '');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<{done: number; total: number} | null>(null);
    const [result, setResult] = useState<RunResult | null>(null);
    const [quota, setQuota] = useState<QuotaState | null>(null);
    const [quotaError, setQuotaError] = useState(false);
    const [templateUnsaved, setTemplateUnsaved] = useState(false);
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cancelRef = useRef(false);
    const [cancelling, setCancelling] = useState(false);

    const selectedDesign = designs.find(d => d.id === designId);
    const {emails, invalid} = useMemo(() => parseEmailList(text), [text]);
    const listed = useMemo(() => countAddresses(emails), [emails]);
    const repeated = useMemo(() => [...listed].filter(([, n]) => n > 1), [listed]);

    // How many passports of this design each address was already sent, so a
    // second one is a choice. Null while loading or if it couldn't be read.
    const [sentBefore, setSentBefore] = useState<Map<string, number> | null>(null);
    const sentBeforeToken = useRef(0);
    const loadSentBefore = useCallback(async (target: string) => {
        const mine = ++sentBeforeToken.current;
        setSentBefore(null);
        try {
            const passports = await fetchPassportsByDesign(target);
            if (mine === sentBeforeToken.current) {
                setSentBefore(countAddresses(passports.map(p => p.sentTo).filter(Boolean)));
            }
        } catch (err) {
            console.error('[PassportEmailer] earlier sends', err);
        }
    }, []);

    useEffect(() => {
        if (designId) void loadSentBefore(designId);
    }, [designId, loadSentBefore]);

    const alreadySent = useMemo(
        () => sentBefore ? [...listed.keys()].flatMap(email => {
            const n = sentBefore.get(email) ?? 0;
            return n > 0 ? [[email, n] as [string, number]] : [];
        }) : [],
        [listed, sentBefore],
    );

    // Leaving would stop the run between chunks without saying where.
    useExitGuard(sending, isEnglish
        ? 'Passports are still being sent. Leaving stops the run, and the addresses not yet sent won’t be listed. Leave anyway?'
        : '通行证仍在发送中。离开将中止发送，且不会列出尚未发送的地址。仍要离开吗？');

    const loadQuota = useCallback(async () => {
        try {
            const res = await callGetTicketEmailQuota();
            setQuota(res.data);
            setQuotaError(false);
        } catch (err) {
            console.error('[PassportEmailer] quota load', err);
            setQuotaError(true);
        }
    }, []);

    useEffect(() => {
        void loadQuota();
    }, [loadQuota]);

    const remainingToday = quota ? Math.max(0, quota.dailyCap - quota.sentToday) : null;
    const remainingQueue = quota ? Math.max(0, quota.queueCap - quota.queuedCount) : null;
    const fullyBlocked = remainingToday === 0 && remainingQueue === 0;

    // Added to the list rather than sent, so it can be checked and edited first.
    const importFile = async (file: File) => {
        if (file.size > MAX_IMPORT_BYTES) {
            showToast(isEnglish ? 'That file is over 5 MB.' : '文件超过 5 MB。', 'error');
            return;
        }
        setImporting(true);
        try {
            let content: string;
            if (/\.xlsx$/i.test(file.name)) {
                // Headers too: in a sheet that's only addresses, the first one is
                // read as a header.
                const {fields, records} = await parseFile(file);
                content = [...fields, ...records.flatMap(r => Object.values(r))].join('\n');
            } else {
                content = await file.text();
            }
            // All of them, repeats too: the notices below point those out.
            const found = parseEmailList(content).emails;
            if (found.length > 0) {
                setText(prev => `${prev.trimEnd()}${prev.trim() ? '\n' : ''}${found.join('\n')}`);
            }
            setResult(null);
            const overlap = found.filter(e => listed.has(e)).length;
            showToast(
                isEnglish
                    ? `Added ${found.length} address${found.length === 1 ? '' : 'es'} from ${file.name}${
                        overlap > 0 ? ` (${overlap} already in the list)` : ''}.`
                    : `已从 ${file.name} 添加 ${found.length} 个地址${
                        overlap > 0 ? `（${overlap} 个已在列表中）` : ''}。`,
                found.length > 0 ? (overlap > 0 ? 'warning' : 'success') : 'warning',
            );
        } catch (err) {
            console.error('[PassportEmailer] import', err);
            showToast(isEnglish
                    ? `Couldn't read ${file.name}${errorSuffix(err, true)}.`
                    : `无法读取 ${file.name}${errorSuffix(err, false)}。`,
                'error');
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const send = async () => {
        if (sending || templateUnsaved || emails.length === 0 || !selectedDesign) return;
        const total = emails.length;
        const ok = window.confirm([
            isEnglish
                ? `Create ${total} “${designLabel(selectedDesign, true)}” passport${total === 1 ? '' : 's'} for ${listed.size} address${listed.size === 1 ? '' : 'es'}, each emailed its own activation key?`
                : `为 ${listed.size} 个地址创建 ${total} 本「${designLabel(selectedDesign, false)}」通行证，并分别发送各自的激活码？`,
            repeated.length > 0
                ? (isEnglish
                    ? `\n\n${repeated.length} address${repeated.length === 1 ? ' is' : 'es are'} listed more than once and will get a passport for each listing.`
                    : `\n\n${repeated.length} 个地址在列表中出现多次，每出现一次都会收到一本通行证。`)
                : '',
            alreadySent.length > 0
                ? (isEnglish
                    ? `\n\n${alreadySent.length} address${alreadySent.length === 1 ? ' was' : 'es were'} already sent one of this design and will get another.`
                    : `\n\n${alreadySent.length} 个地址已收到过此设计，将再收到一本。`)
                : '',
            remainingToday !== null && total > remainingToday
                ? (isEnglish
                    ? `\n\nOnly ${remainingToday} can go now. Up to ${remainingQueue} more will queue and go out as the daily cap frees up; any past that stay in the list for another day.`
                    : `\n\n当前仅可立即发送 ${remainingToday} 封。至多 ${remainingQueue} 封将排队，待每日额度恢复后发送；超出部分将留在列表中，改日再发。`)
                : '',
        ].join(''));
        if (!ok) return;

        cancelRef.current = false;
        setSending(true);
        setResult(null);
        setProgress({done: 0, total});

        let sent = 0;
        let queued = 0;
        // Not sent: put back in the list once the run ends.
        const leftOver: string[] = [];
        let done = 0;
        try {
            while (done < total && !cancelRef.current) {
                const chunk = emails.slice(done, done + MAX_PASSPORT_EMAIL);
                const {data} = await callEmailPassports({designId: selectedDesign.id, emails: chunk});
                done += chunk.length;
                sent += data.sentCount;
                queued += data.queuedCount;
                leftOver.push(...data.deferred, ...data.failed);
                setProgress({done, total});
                if (data.failed.length > 0) {
                    showToast(isEnglish
                            ? `Resend refused ${data.failed.length} email${data.failed.length === 1 ? '' : 's'}; stopped. They’re back in the list.`
                            : `Resend 拒绝了 ${data.failed.length} 封邮件，已停止。这些地址已放回列表。`,
                        'error');
                    break;
                }
                // No room left today or in the queue, so the rest would only
                // come back the same way.
                if (data.deferred.length > 0) break;
            }
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                code === 'no-template'
                    ? (isEnglish ? 'Save the email template before sending.' : '请先保存邮件模板再发送。')
                    : code === 'no-key-placeholder'
                        ? (isEnglish
                            ? 'The template needs {{ activationCode }} or {{ activateUrl }} before passports can be sent.'
                            : '模板需包含 {{ activationCode }} 或 {{ activateUrl }} 才能发送通行证。')
                        : code === 'no-contact-email'
                            ? (isEnglish
                                ? 'The template uses {{ contactEmail }}. Set a Contact Email in Site Config before sending.'
                                : '模板使用了 {{ contactEmail }}，请先在网站设置中填写联系邮箱再发送。')
                            : code === 'quota-exceeded'
                                ? (isEnglish
                                    ? 'Daily cap reached and the overflow queue is full.'
                                    : '已达到每日上限，且排队已满。')
                                : (isEnglish
                                    ? `Send failed${errorSuffix(err, true)}.`
                                    : `发送失败${errorSuffix(err, false)}。`),
                code === 'quota-exceeded' ? 'warning' : 'error',
            );
        } finally {
            // Only once a batch has gone through: stopped before that, the list
            // stays as typed.
            if (done > 0) {
                const left = [...leftOver, ...emails.slice(done)];
                setText(left.join('\n'));
                setResult({sent, queued, left: left.length});
                void loadSentBefore(selectedDesign.id);
            }
            setSending(false);
            setProgress(null);
            cancelRef.current = false;
            setCancelling(false);
            void loadQuota();
        }
    };

    const leave = () => {
        if (confirmExit()) onBack();
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={leave} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Email Passports' : '邮件发送通行证'}</h3>
            </div>

            <div className="admin-tickets-send admin-section-mb">
                <h3>{isEnglish ? 'Recipients' : '收件人'}</h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'Each address gets a passport of its own from the design below, with its activation key in the email. No sticker is printed; once activated, the passport shows on the holder’s profile. List an address twice to send it two, for someone who bought two.'
                        : '每个地址都会获得一本以下方设计生成的通行证，激活码随邮件发送。不打印贴纸；激活后，通行证会显示在持有者的个人主页上。如有人购买了两本，将其地址列出两次即可发送两本。'}
                </p>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Design' : '设计'}</span>
                    <DesignSelect designs={designs} value={designId} onChange={setDesignId} disabled={sending}/>
                    <DesignTermHint design={selectedDesign}/>
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Email addresses' : '邮箱地址'}</span>
                    <textarea
                        className="admin-tickets-template-textarea"
                        value={text}
                        onChange={e => {
                            setText(e.target.value);
                            setResult(null);
                        }}
                        placeholder={isEnglish
                            ? 'One per line, or separated by commas'
                            : '每行一个，或以逗号分隔'}
                        rows={8}
                        readOnly={sending}
                    />
                </label>

                <div className="admin-tickets-import-file-row">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) void importFile(file);
                        }}
                        disabled={sending || importing}
                    />
                    <span className="admin-helper-text">
                        {isEnglish
                            ? 'Import a CSV, XLSX or text file: every address in it is added to the list.'
                            : '导入 CSV、XLSX 或文本文件：其中所有地址都会加入列表。'}
                    </span>
                </div>

                <p className="admin-helper-text">
                    {isEnglish
                        ? `${emails.length} passport${emails.length === 1 ? '' : 's'} for ${listed.size} address${listed.size === 1 ? '' : 'es'}.`
                        : `共 ${emails.length} 本通行证，发送至 ${listed.size} 个地址。`}
                </p>
                {/* Sent as listed, so a slip of the paste shows here before it
                    costs a passport. */}
                {repeated.length > 0 && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `Listed more than once, so sent a passport for each listing: ${nameAddresses(repeated, true)}. Remove the extras if that isn’t meant.`
                            : `以下地址出现多次，每出现一次都会收到一本通行证：${nameAddresses(repeated, false)}。如非有意，请删除多余的条目。`}
                    </p>
                )}
                {alreadySent.length > 0 && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `Already sent this design before, and will get another: ${nameAddresses(alreadySent, true)}.`
                            : `以下地址此前已收到过此设计，将再收到一本：${nameAddresses(alreadySent, false)}。`}
                    </p>
                )}
                {invalid.length > 0 && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `Not addresses, so passed over: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ''}.`
                            : `以下不是有效地址，将被跳过：${invalid.slice(0, 5).join('、')}${invalid.length > 5 ? ` 等另外 ${invalid.length - 5} 个` : ''}。`}
                    </p>
                )}

                {templateUnsaved && (
                    <div className="admin-tickets-send-banner admin-tickets-send-banner-warning">
                        <strong>{isEnglish ? 'Email template not saved.' : '邮件模板尚未保存。'}</strong>
                        <p>
                            {isEnglish
                                ? 'Save the template below before sending. Emails go out with the saved version.'
                                : '发送前请先保存下方的模板。邮件将按已保存的版本发送。'}
                        </p>
                    </div>
                )}

                <div className={`admin-tickets-send-banner ${
                    quotaError ? 'admin-tickets-send-banner-warning'
                        : fullyBlocked ? 'admin-tickets-send-banner-error'
                            : remainingToday !== null && remainingToday <= 10 ? 'admin-tickets-send-banner-warning'
                                : 'admin-tickets-send-banner-info'}`}>
                    {quotaError ? (
                        <span>
                            {isEnglish
                                ? 'Could not load the Resend quota. Sending still works.'
                                : '无法加载 Resend 额度。发送功能仍可使用。'}
                        </span>
                    ) : quota ? (
                        <span>
                            {isEnglish
                                ? `${remainingToday} of ${quota.dailyCap} emails left in the rolling 24-hour window, shared with ticket emails. Overflow queue: ${quota.queuedCount} / ${quota.queueCap}.`
                                : `24 小时滚动窗口内剩余 ${remainingToday} / ${quota.dailyCap} 封（与门票邮件共用）。待发队列：${quota.queuedCount} / ${quota.queueCap}。`}
                        </span>
                    ) : (
                        <span>{isEnglish ? 'Loading quota...' : '加载额度中...'}</span>
                    )}
                </div>

                {progress && (
                    <div className="admin-tickets-send-progress">
                        <div className="admin-tickets-send-progress-label">
                            {isEnglish
                                ? `Sending ${progress.done} / ${progress.total}...`
                                : `发送中 ${progress.done} / ${progress.total}...`}
                            {cancelling && (
                                <span> {isEnglish ? '(stopping after the current batch)' : '（将在本批后停止）'}</span>
                            )}
                        </div>
                        <div className="admin-tickets-send-progress-track">
                            <div
                                className="admin-tickets-send-progress-fill"
                                style={{width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%`}}
                            />
                        </div>
                    </div>
                )}

                {result && (
                    <div className={`admin-tickets-send-banner ${
                        result.left > 0 ? 'admin-tickets-send-banner-warning' : 'admin-tickets-send-banner-info'}`}>
                        <strong>
                            {isEnglish
                                ? `Sent ${result.sent}${result.queued > 0 ? `, queued ${result.queued}` : ''}.`
                                : `已发送 ${result.sent}${result.queued > 0 ? `，已排队 ${result.queued}` : ''}。`}
                        </strong>
                        {result.queued > 0 && (
                            <p>
                                {isEnglish
                                    ? 'Queued emails go out on their own as the daily cap frees up.'
                                    : '排队的邮件将在每日额度恢复后自动发送。'}
                            </p>
                        )}
                        {result.left > 0 && (
                            <p>
                                {isEnglish
                                    ? `${result.left} not sent ${result.left === 1 ? 'is' : 'are'} left in the list; send again later to pick up where this stopped.`
                                    : `${result.left} 个未发送的地址已留在列表中，稍后再次发送即可从此处继续。`}
                            </p>
                        )}
                    </div>
                )}

                <div className="admin-btn-row">
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={() => void send()}
                        disabled={sending || importing || templateUnsaved || emails.length === 0
                            || !selectedDesign || fullyBlocked}
                    >
                        {sending
                            ? (isEnglish ? 'Sending...' : '发送中...')
                            : (isEnglish
                                ? `Create & Email ${emails.length} Passport${emails.length === 1 ? '' : 's'}`
                                : `创建并发送 ${emails.length} 本通行证`)}
                    </button>
                    {sending && (
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                cancelRef.current = true;
                                setCancelling(true);
                            }}
                            disabled={cancelling}
                        >
                            {isEnglish ? 'Stop' : '停止'}
                        </button>
                    )}
                </div>
            </div>

            <PassportEmailTemplateSection
                design={selectedDesign}
                showToast={showToast}
                onUnsavedChange={setTemplateUnsaved}
            />
        </div>
    );
};
