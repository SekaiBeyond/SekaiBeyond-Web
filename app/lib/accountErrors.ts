import { FirebaseError } from 'firebase/app';
import { functionsErrorCode } from '~/lib/firebase';

/** What went wrong with an account call, in the visitor's language. */
export function accountErrorMessage(err: unknown, isEnglish: boolean): string {
    switch (functionsErrorCode(err) ?? (err instanceof FirebaseError ? err.code : null)) {
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
            return isEnglish
                ? 'Your account is due to be deleted, so its email can’t change unless the deletion is cancelled.'
                : '您的账号即将被删除，取消删除前无法更改邮箱。';
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
        case 'functions/invalid-argument':
            return isEnglish ? 'Please check what you entered.' : '请检查您输入的内容。';
        default:
            return isEnglish ? 'Something went wrong. Please try again.' : '出错了，请重试。';
    }
}
