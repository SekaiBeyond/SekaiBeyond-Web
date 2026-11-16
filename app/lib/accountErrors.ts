import { errorCode, functionsErrorDetails } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';

/** A banned account's refusal, saying until when if the ban runs out. */
function bannedMessage(err: unknown, isEnglish: boolean): string {
    const raw = functionsErrorDetails<{until?: unknown}>(err)?.until;
    const until = typeof raw === 'string' ? new Date(raw) : null;
    if (until && !Number.isNaN(until.getTime())) {
        const when = formatSiteTime(until, isEnglish, {
            year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
        return isEnglish
            ? `This account is banned until ${when}. If you think this is a mistake, please contact us.`
            : `此账号已被封禁，至 ${when} 解除。如您认为有误，请联系我们。`;
    }
    return isEnglish
        ? 'This account has been banned. If you think this is a mistake, please contact us.'
        : '此账号已被封禁。如您认为有误，请联系我们。';
}

/** A link refused while one side waits out the 30 days after an earlier one was undone. */
function linkHoldMessage(details: {side?: unknown; until?: unknown} | null, isEnglish: boolean): string {
    const until = typeof details?.until === 'string' ? new Date(details.until) : null;
    const when = until && !Number.isNaN(until.getTime())
        ? formatSiteTime(until, isEnglish, {year: 'numeric', month: 'long', day: 'numeric'})
        : null;
    if (details?.side === 'account') {
        return isEnglish
            ? `Your account was linked to someone else in this app recently, so it can only link another${when ? ` from ${when}` : ' later'}. If you linked the wrong account of yours, contact us.`
            : `您的账号最近在此应用中绑定过其他账号，${when ? `需等到 ${when} 后` : '稍后'}才能绑定新的账号。如果您绑错了自己的另一个账号，请联系我们。`;
    }
    return isEnglish
        ? `That app account was linked to another account recently, so it can only link this one${when ? ` from ${when}` : ' later'}.`
        : `该应用账号最近绑定过其他账号，${when ? `需等到 ${when} 后` : '稍后'}才能绑定此账号。`;
}

const accountLinkedMessage = (isEnglish: boolean) =>
    isEnglish ? 'Your account is already linked in this app. Unlink it first.' : '您的账号已在此应用中绑定，请先解绑。';

const appUserLinkedMessage = (isEnglish: boolean) =>
    isEnglish ? 'That app account is already linked to another account here.' : '该应用账号已绑定本站的其他账号。';

const deletionPendingMessage = (isEnglish: boolean) =>
    isEnglish
        ? 'Your account is due to be deleted, so this can’t be done unless the deletion is cancelled.'
        : '您的账号即将被删除，取消删除前无法进行此操作。';

/**
 * Why the app's claim on a link request was refused, as the request keeps it
 * for Settings to show (LinkRefusal in functions/src/utils/appLinks.ts).
 */
export function linkRefusalMessage(refusal: {code: string; side?: string; until?: string}, isEnglish: boolean): string {
    switch (refusal.code) {
        case 'link-on-hold':
            return linkHoldMessage(refusal, isEnglish);
        case 'app-user-linked':
            return appUserLinkedMessage(isEnglish);
        case 'account-linked':
            return accountLinkedMessage(isEnglish);
        case 'deletion-pending':
            return deletionPendingMessage(isEnglish);
        default:
            return isEnglish ? 'It couldn’t be linked.' : '无法绑定。';
    }
}

/** What went wrong with an account call, in the visitor's language. */
export function accountErrorMessage(err: unknown, isEnglish: boolean): string {
    switch (errorCode(err)) {
        case 'account-banned':
        // Firebase's own refusal of a disabled account, should a sign-in get that far.
        case 'auth/user-disabled':
            return bannedMessage(err, isEnglish);
        case 'wrong-credentials':
            return isEnglish ? 'Wrong email or password.' : '邮箱或密码不正确。';
        case 'bad-code':
            return isEnglish ? 'That code isn’t right, or it has expired.' : '验证码不正确或已过期。';
        case 'email-taken':
            return isEnglish ? 'That email already has an account.' : '此邮箱已有账号。';
        case 'email-held':
            return isEnglish
                ? 'The account on that email moved to another address in the last few days, so the email is held for it for now. If it’s your account, use the Undo this change link we emailed to that address.'
                : '使用该邮箱的账号最近改用了其他邮箱，因此该邮箱暂时为其保留。如果那是您的账号，请使用我们发送到该邮箱的“撤销此更改”链接。';
        case 'google-taken':
            return isEnglish ? 'That Google account is bound to another account.' : '此 Google 账号已绑定其他账号。';
        case 'google-already-bound':
            return isEnglish ? 'This account already has a Google account bound.' : '此账号已绑定 Google 账号。';
        case 'bad-google-token':
            return isEnglish ? 'Google sign-in didn’t work or has expired. Please try again.' : 'Google 登录失败或已过期，请重试。';
        case 'needs-password':
            return isEnglish ? 'Set a password first, or you’d have no way to sign in.' : '请先设置密码，否则将无法登录。';
        case 'same-email':
            return isEnglish ? 'That’s already your email.' : '这已是您的邮箱。';
        case 'email-change-locked':
            return isEnglish ? 'Your email can only change once a month.' : '邮箱每月只能更改一次。';
        case 'deletion-pending':
            // Changing the email and linking an app both refuse with it.
            return deletionPendingMessage(isEnglish);
        case 'weak-password':
            return isEnglish ? 'Passwords need at least 8 characters.' : '密码至少需要 8 个字符。';
        case 'breached-password':
            return isEnglish
                ? 'That password has appeared in a data breach, so it’s among the first anyone would guess. Please choose another.'
                : '该密码曾出现在数据泄露中，很容易被猜到，请换一个。';
        case 'too-many-changes':
            return isEnglish
                ? 'You’ve made this change too many times today. Please try again later.'
                : '今天此项更改次数过多，请稍后再试。';
        case 'email-undeliverable':
            return isEnglish
                ? 'That address can’t receive email. Please check it for typos.'
                : '该邮箱地址无法接收邮件，请检查是否有拼写错误。';
        case 'deletion-by-staff':
            return isEnglish ? 'Staff scheduled this deletion, so only staff can cancel it.' : '此删除由工作人员安排，只有工作人员可以取消。';
        case 'no-name':
            return isEnglish ? 'Please enter a name.' : '请输入名称。';
        case 'rate-limited':
            return isEnglish ? 'Too many attempts. Please wait a while and try again.' : '尝试次数过多，请稍后再试。';
        case 'mail-unavailable':
            return isEnglish ? 'We couldn’t send the email just now. Please try again later.' : '暂时无法发送邮件，请稍后再试。';
        case 'linking-off':
            return isEnglish ? 'This app doesn’t link accounts right now.' : '此应用目前不支持绑定账号。';
        case 'account-linked':
            return accountLinkedMessage(isEnglish);
        case 'app-user-linked':
            return appUserLinkedMessage(isEnglish);
        case 'link-on-hold':
            return linkHoldMessage(functionsErrorDetails<{side?: unknown; until?: unknown}>(err), isEnglish);
        case 'link-request-gone':
            return isEnglish ? 'This code has run out. Start again for a new one.' : '此二维码已过期，请重新开始。';
        case 'link-not-claimed':
            return isEnglish ? 'Nobody has scanned the code yet.' : '还没有人扫描此二维码。';
        case 'wrong-link-code': {
            const left = functionsErrorDetails<{attemptsLeft?: unknown}>(err)?.attemptsLeft;
            const tries = typeof left === 'number' ? left : null;
            return isEnglish
                ? `That isn’t the code the app shows.${tries ? ` ${tries} ${tries === 1 ? 'try' : 'tries'} left.` : ''}`
                : `这不是应用中显示的数字。${tries ? `还可尝试 ${tries} 次。` : ''}`;
        }
        case 'link-code-spent':
            return isEnglish
                ? 'Too many wrong codes, so this request was cancelled. Start again.'
                : '输错次数过多，此请求已取消，请重新开始。';
        case 'functions/invalid-argument':
            return isEnglish ? 'Please check what you entered.' : '请检查您输入的内容。';
        default:
            return isEnglish ? 'Something went wrong. Please try again.' : '出错了，请重试。';
    }
}
