import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetWalletPassStatus, type WalletPassStatus } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { Banner } from '../Banner';
import { StatTile } from '../StatTile';
import { useToolLoader } from '../ToolHeader';
import { QuotaMeter, QuotaNotes, QuotaPage } from './QuotaParts';

interface WalletPassesToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

const LOW_HEADROOM = 50;

const nextMonthStart = (month: string): string => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return '';
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

const formatDay = (day: string, isEnglish: boolean): string => {
    const ms = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(ms)) return day;
    return new Intl.DateTimeFormat(isEnglish ? 'en-US' : 'zh-CN', {
        timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
    }).format(ms);
};

export const WalletPassesTool = ({onBack, showToast}: WalletPassesToolProps) => {
    const {isEnglish} = useLanguage();
    const [status, setStatus] = useState<WalletPassStatus | null>(null);

    const {loading, error, load} = useToolLoader(callGetWalletPassStatus, setStatus,
        {
            refreshed: {en: 'Usage refreshed.', zh: '用量已刷新。'},
            failed: {en: 'Could not load wallet pass usage.', zh: '无法加载钱包票券用量。'}
        }, showToast);

    const off = status !== null && (!status.configured || status.cap === 0 || status.perTicketDailyCap === 0);
    const remaining = status ? Math.max(0, status.limit - status.used) : 0;
    const atLimit = status !== null && !off && remaining === 0;
    const lowHeadroom = status !== null && !off && remaining > 0 && remaining <= LOW_HEADROOM;
    const usedPct = status ? Math.min(100, (status.used / Math.max(1, status.limit)) * 100) : 0;
    const resetDay = status
        ? formatDay(status.provider?.resetDate || nextMonthStart(status.month), isEnglish)
        : '';

    return (
        <QuotaPage
            title={isEnglish ? 'Wallet Passes' : '电子钱包票券'}
            intro={isEnglish
                ? 'Every ticket in a ticket email has an Add to Wallet button. The first tap makes an Apple or Google Wallet pass with WalletWallet, whose barcode scans at check-in like the email\'s QR code, and later taps open the same pass. Past this month\'s limit, the button shows a notice instead until the 1st; the email\'s QR code still works.'
                : '门票邮件中的每张门票都有"添加到钱包"按钮。首次点击时由 WalletWallet 生成 Apple / Google 钱包票券，其条码在检票时与邮件中的二维码一样可以扫描，之后再点击会打开同一张票券。超出本月上限后，按钮将显示提示直至下月 1 日，邮件中的二维码仍可使用。'}
            failed={isEnglish ? 'Could not load wallet pass usage. Try refreshing.' : '无法加载钱包票券用量，请尝试刷新。'}
            onBack={onBack}
            loading={loading}
            error={error}
            load={load}
        >
            {status && (
                <>
                    <Banner tone={off || atLimit || lowHeadroom || status.readingSource !== 'live' ? 'warning' : 'info'}>
                        <span>
                            {!status.configured
                                ? (isEnglish
                                    ? 'Wallet passes are off: no WalletWallet API key is set on the server (the WALLETWALLET_API_KEY secret). Ticket emails go out without them.'
                                    : '钱包票券未启用：服务器未设置 WalletWallet API 密钥（WALLETWALLET_API_KEY 机密）。门票邮件将不附带票券。')
                                : off
                                    ? (isEnglish
                                        ? `Wallet passes are off: ${status.cap === 0 ? 'WALLET_PASS_MONTHLY_CAP' : 'WALLET_PASS_DAILY_CAP_PER_TICKET'} is 0. Ticket emails go out without the button.`
                                        : `钱包票券未启用：${status.cap === 0 ? 'WALLET_PASS_MONTHLY_CAP' : 'WALLET_PASS_DAILY_CAP_PER_TICKET'} 为 0。门票邮件将不附带按钮。`)
                                    : atLimit
                                        ? (isEnglish
                                            ? `This month's ${status.limit} passes are used. Until ${resetDay}, Add to Wallet shows a notice instead of making one.`
                                            : `本月 ${status.limit} 张票券额度已用完。${resetDay}前点击"添加到钱包"将显示提示，不再生成票券。`)
                                        : status.readingSource !== 'live'
                                            ? (isEnglish
                                                ? `Couldn't reach WalletWallet, so this is this site's own count: ${remaining} of ${status.limit} passes left this month. Check the WalletWallet dashboard for its figure.`
                                                : `无法连接 WalletWallet，以下为本站自行统计：本月还剩 ${remaining} / ${status.limit} 张票券。准确用量请查看 WalletWallet 控制台。`)
                                            : lowHeadroom
                                                ? (isEnglish
                                                    ? `Only ${remaining} pass${remaining === 1 ? '' : 'es'} left this month.`
                                                    : `本月仅剩 ${remaining} 张票券额度。`)
                                                : (isEnglish
                                                    ? `${remaining} of ${status.limit} passes still available this month.`
                                                    : `本月还有 ${remaining} / ${status.limit} 张票券可用。`)}
                        </span>
                    </Banner>

                    {!off && (
                        <QuotaMeter parts={[
                            {kind: 'confirmed', pct: usedPct, label: `${isEnglish ? 'Used' : '已用'} (${status.used})`},
                            {kind: 'free', label: `${isEnglish ? 'Available' : '可用'} (${remaining})`},
                        ]}/>
                    )}

                    <div className="admin-stats-tiles admin-section-mb">
                        <StatTile
                            label={isEnglish ? 'Used this month' : '本月已用'}
                            value={`${status.used} / ${status.limit}`}
                            sub={isEnglish ? 'what Add to Wallet is held to' : '"添加到钱包"以此为限'}
                        />
                        <StatTile
                            label={isEnglish ? 'Per WalletWallet' : 'WalletWallet 记录'}
                            value={status.provider === null
                                ? (isEnglish ? 'Unavailable' : '无法读取')
                                : `${status.provider.count} / ${status.provider.limit}`}
                            sub={status.provider
                                ? (isEnglish ? `${status.provider.plan || 'unknown'} plan` : `${status.provider.plan || '未知'} 方案`)
                                : (isEnglish ? 'not reachable' : '无法连接')}
                        />
                        <StatTile
                            label={isEnglish ? 'Available' : '可用额度'}
                            value={off ? '—' : remaining}
                            sub={isEnglish ? 'one per ticket, on its first tap' : '每张门票首次点击时使用一张'}
                        />
                        <StatTile
                            label={isEnglish ? 'Resets' : '重置日期'}
                            value={resetDay}
                            sub={isEnglish ? 'the 1st of each month (UTC)' : '每月 1 日（UTC）'}
                        />
                    </div>

                    <QuotaNotes>
                        <li>
                            {isEnglish
                                ? `Add to Wallet stops making passes at ${status.limit} a month: the cap set on the server (${status.cap}), or WalletWallet's plan limit if that's lower.`
                                : `"添加到钱包"每月最多生成 ${status.limit} 张票券：取服务器设置的上限（${status.cap}）与 WalletWallet 方案上限中较低者。`}
                        </li>
                        <li>
                            {isEnglish
                                ? '"Used this month" is this site\'s own count, raised to WalletWallet\'s whenever that is higher, so passes made elsewhere on the account count too. WalletWallet\'s figure is read each time this page loads.'
                                : '"本月已用"为本站自行统计，若 WalletWallet 记录更高则以其为准，因此在该账号其他地方生成的票券也会计入。每次打开本页时都会读取 WalletWallet 的数据。'}
                        </li>
                        <li>
                            {isEnglish
                                ? 'A ticket uses one pass, on the first tap of its button; tapping again, or re-sending the email, opens the same pass. Voiding a ticket revokes its pass, which doesn\'t give it back.'
                                : '每张门票在首次点击按钮时使用一张票券额度；再次点击或重新发送邮件都会打开同一张票券。作废门票会吊销其票券，但不会退还额度。'}
                        </li>
                        <li>
                            {isEnglish
                                ? `A ticket can make at most ${status.perTicketDailyCap} new pass${status.perTicketDailyCap === 1 ? '' : 'es'} a day (WALLET_PASS_DAILY_CAP_PER_TICKET), which only matters when it has none to reuse: after a void and unvoid, a retry after WalletWallet didn't answer, or if one couldn't be saved. Taps at the same moment share one pass.`
                                : `每张门票每天最多生成 ${status.perTicketDailyCap} 张新票券（WALLET_PASS_DAILY_CAP_PER_TICKET），仅在没有可沿用的票券时生效：例如作废后又恢复、WalletWallet 未响应后重试，或票券未能保存。同时多次点击只会生成一张票券。`}
                        </li>
                        {status.provider?.trialExpiresAt && (
                            <li>
                                {isEnglish
                                    ? `WalletWallet trial ends ${status.provider.trialExpiresAt}.`
                                    : `WalletWallet 试用期截至 ${status.provider.trialExpiresAt}。`}
                            </li>
                        )}
                    </QuotaNotes>
                </>
            )}
        </QuotaPage>
    );
};
