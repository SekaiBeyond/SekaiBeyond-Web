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
        case 'weak-password':
            return isEnglish ? 'Passwords need at least 8 characters.' : '密码至少需要 8 个字符。';
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
