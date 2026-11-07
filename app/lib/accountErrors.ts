import { functionsErrorCode } from '~/lib/firebase';

/** What went wrong with an account call, in the visitor's language. */
export function accountErrorMessage(err: unknown, isEnglish: boolean): string {
    switch (functionsErrorCode(err)) {
        case 'wrong-credentials':
            return isEnglish ? 'Wrong email or password.' : '邮箱或密码不正确。';
        case 'bad-code':
            return isEnglish ? 'That code isn’t right, or it has expired.' : '验证码不正确或已过期。';
        case 'email-taken':
            return isEnglish ? 'That email already has an account.' : '此邮箱已有账号。';
        case 'weak-password':
            return isEnglish ? 'Passwords need at least 8 characters.' : '密码至少需要 8 个字符。';
        case 'no-name':
            return isEnglish ? 'Please enter a name.' : '请输入名称。';
        case 'rate-limited':
            return isEnglish ? 'Too many attempts. Please wait a while and try again.' : '尝试次数过多，请稍后再试。';
        case 'mail-unavailable':
            return isEnglish ? 'We couldn’t send the email just now. Please try again later.' : '暂时无法发送邮件，请稍后再试。';
        default:
            return isEnglish ? 'Something went wrong. Please try again.' : '出错了，请重试。';
    }
}
