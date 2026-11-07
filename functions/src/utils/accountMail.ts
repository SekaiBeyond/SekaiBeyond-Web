import { HttpsError } from "firebase-functions/v2/https";
import { PUBLIC_ORIGIN, RESEND_DAILY_CAP } from "./config";
import { maskEmail } from "./accountEmail";
import { CODE_TTL_MINUTES, type CodePurpose } from "./emailCodes";
import { escapeHtml } from "./emailTemplate";
import { db } from "./firebase";
import { computeEmailQuotaInTxn, reserveQuotaInTxn, rollbackQuotaReservation } from "./quota";
import { type ResendEnvelope, ResendSendError, sendEmails } from "./resendClient";

/**
 * The emails an account gets. Fixed here rather than saved in the admin panel
 * like ticket emails: they're the same for everyone, and a broken template
 * would stop people signing in. Both languages are written out, and which one
 * goes is the language the site was in when it was asked for.
 */

export type MailLanguage = "en" | "zh";

export const readMailLanguage = (raw: unknown): MailLanguage => raw === "zh" ? "zh" : "en";

const SEND_TIMEOUT_MS = 8_000;

const mailUnavailable = () =>
    new HttpsError("unavailable", "Couldn't send the email. Please try again later.", {code: "mail-unavailable"});

/**
 * Sends one email straight away, skipping the overflow queue: it's no use to
 * someone waiting on a code half an hour later. May use the whole daily cap, so
 * the reserve kept from bulk mail is what's left when a big send has run.
 */
export async function sendAccountMail(envelope: ResendEnvelope): Promise<void> {
    const allowed = await db.runTransaction(async (txn) => {
        const {sentToday, reserved} = await computeEmailQuotaInTxn(txn);
        if (sentToday >= RESEND_DAILY_CAP) return false;
        reserveQuotaInTxn(txn, 1, reserved);
        return true;
    });
    if (!allowed) throw mailUnavailable();

    try {
        await sendEmails([envelope], SEND_TIMEOUT_MS);
    } catch (err) {
        console.error("sendAccountMail: send failed", err);
        // Unless a quota header came back, which resendClient has already recorded.
        if (!(err instanceof ResendSendError && err.dailyConsumed !== null)) await rollbackQuotaReservation(1);
        throw mailUnavailable();
    }
}

/** For a heads-up after the fact: what it's about has happened, so a failure stops at the log. */
export async function sendNotice(envelope: ResendEnvelope): Promise<void> {
    try {
        await sendAccountMail(envelope);
    } catch (err) {
        console.error("sendNotice: not sent", err);
    }
}

function page(heading: string, paragraphs: string[]): string {
    const body = paragraphs
        .map(p => `<p style="margin:0 0 16px;color:#4a4a4a;font-size:15px;line-height:1.6;">${p}</p>`)
        .join("");
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
<h1 style="margin:0 0 24px;color:#ff6b9d;font-size:22px;">${heading}</h1>${body}
<p style="margin:32px 0 0;color:#9a9a9a;font-size:13px;"><a href="${escapeHtml(PUBLIC_ORIGIN)}" style="color:#9a9a9a;">Sekai Beyond</a></p>
</div>`;
}

const codeBlock = (code: string) =>
    `<span style="display:inline-block;padding:12px 20px;border-radius:8px;background-color:#fff0f6;color:#333333;font-size:28px;font-weight:700;letter-spacing:6px;">${code}</span>`;

const CODE_LEADS: Record<CodePurpose, Record<MailLanguage, string>> = {
    "signup": {
        en: "Use this code to finish creating your Sekai Beyond account.",
        zh: "请使用此验证码完成 Sekai Beyond 账号注册。",
    },
    "password": {
        en: "Use this code to set a new password for your Sekai Beyond account.",
        zh: "请使用此验证码为您的 Sekai Beyond 账号设置新密码。",
    },
    "email-change": {
        en: "Use this code to make this the email address of your Sekai Beyond account.",
        zh: "请使用此验证码将此地址设为您的 Sekai Beyond 账号邮箱。",
    },
};

// The code leads the subject, so it can be read off a notification. The
// emulator logs subjects, which is how a local sign-up gets its code.
export function codeMail(to: string, purpose: CodePurpose, code: string, language: MailLanguage): ResendEnvelope {
    return language === "zh" ? {
        to,
        subject: `${code} 是您的 Sekai Beyond 验证码`,
        html: page("您的验证码", [
            CODE_LEADS[purpose].zh,
            codeBlock(code),
            `验证码在 ${CODE_TTL_MINUTES} 分钟内有效。如果这不是您本人的操作，请忽略此邮件，您的账号不会有任何变化。`,
        ]),
    } : {
        to,
        subject: `${code} is your Sekai Beyond code`,
        html: page("Your code", [
            CODE_LEADS[purpose].en,
            codeBlock(code),
            `It works for ${CODE_TTL_MINUTES} minutes. If this wasn't you, you can ignore this email and nothing will change.`,
        ]),
    };
}

/** Sent in place of a code when the address already has an account, so the form gives nothing away. */
export function addressTakenMail(to: string, language: MailLanguage): ResendEnvelope {
    const site = escapeHtml(PUBLIC_ORIGIN);
    return language === "zh" ? {
        to,
        subject: "您已有 Sekai Beyond 账号",
        html: page("您已有账号", [
            "有人尝试用此邮箱地址使用 Sekai Beyond，但此地址已属于一个账号。",
            `如果这是您本人的操作，请直接在 <a href="${site}">网站</a> 登录；忘记密码时，可在登录窗口中重新设置。如果不是，请忽略此邮件。`,
        ]),
    } : {
        to,
        subject: "You already have a Sekai Beyond account",
        html: page("You already have an account", [
            "Someone tried to use this address on Sekai Beyond, but it already belongs to an account.",
            `If that was you, just <a href="${site}">sign in</a>, and use Forgot password if you need to. If it wasn't, you can ignore this email.`,
        ]),
    };
}

/** "contact us at …", or the site, without a Contact Email in Site Config. */
async function contactLine(language: MailLanguage): Promise<string> {
    const saved: unknown = (await db.collection("config").doc("main").get()).get("contactEmail");
    const contact = typeof saved === "string" ? escapeHtml(saved) : "";
    if (language === "zh") {
        return contact ? `如果这不是您本人的操作，请立即联系 ${contact}。` : "如果这不是您本人的操作，请立即联系我们。";
    }
    return contact ? `If this wasn't you, contact ${contact} right away.` : "If this wasn't you, contact us right away.";
}

/** To the address an account has just left, which is how someone whose session was stolen finds out. */
export async function emailChangedMail(to: string, newEmail: string, language: MailLanguage): Promise<ResendEnvelope> {
    const masked = escapeHtml(maskEmail(newEmail));
    const contact = await contactLine(language);
    return language === "zh" ? {
        to,
        subject: "您的 Sekai Beyond 账号邮箱已更改",
        html: page("账号邮箱已更改", [`您的账号邮箱已更改为 ${masked}，此地址将不再用于登录。`, contact]),
    } : {
        to,
        subject: "Your Sekai Beyond email has changed",
        html: page("Your email has changed", [
            `Your account's email is now ${masked}, and this address no longer signs in to it.`,
            contact,
        ]),
    };
}

/** To the address staff have just put an account on, which can sign in to it from now on. */
export async function emailSetByStaffMail(to: string, language: MailLanguage): Promise<ResendEnvelope> {
    const contact = await contactLine(language);
    return language === "zh" ? {
        to,
        subject: "此地址已成为您的 Sekai Beyond 账号邮箱",
        html: page("账号邮箱已设置", ["Sekai Beyond 工作人员已将此地址设为一个账号的邮箱，可用它登录。", contact]),
    } : {
        to,
        subject: "This address now signs in to Sekai Beyond",
        html: page("Your account email is set", [
            "Sekai Beyond staff have made this the email of an account, and it can now sign in to it.",
            contact,
        ]),
    };
}

export async function passwordChangedMail(to: string, language: MailLanguage): Promise<ResendEnvelope> {
    const contact = await contactLine(language);
    return language === "zh" ? {
        to,
        subject: "您的 Sekai Beyond 密码已更改",
        html: page("密码已更改", ["您账号的密码刚刚被更改，其他设备已退出登录。", contact]),
    } : {
        to,
        subject: "Your Sekai Beyond password has changed",
        html: page("Your password has changed", [
            "The password on your account was just changed, and your other devices have been signed out.",
            contact,
        ]),
    };
}
