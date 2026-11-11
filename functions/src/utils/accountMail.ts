import { HttpsError } from "firebase-functions/v2/https";
import { chargeRateLimit, rateLimitHasRoom } from "./auth";
import { CODE_MAIL_HOURLY_CAP, NOTICE_MAIL_RESERVE, PUBLIC_ORIGIN, RESEND_DAILY_CAP } from "./config";
import { maskEmail } from "./accountEmail";
import { CODE_TTL_MINUTES, type CodePurpose } from "./emailCodes";
import { EMAIL_UNDO_DAYS } from "./emailUndo";
import { escapeHtml } from "./emailTemplate";
import { db } from "./firebase";
import { computeEmailQuotaDetail, computeEmailQuotaInTxn, reserveQuotaInTxn, rollbackQuotaReservation, } from "./quota";
import { type ResendEnvelope, ResendSendError, sendEmails } from "./resendClient";
import { SITE_TIME_ZONE } from "./siteTime";

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
 * A code, or what's sent in place of one, which anyone can ask for; or a notice
 * of something that has happened to an account, which only that account's
 * changes send.
 */
export type AccountMailKind = "code" | "notice";

const HOUR_MS = 60 * 60_000;

// Every code email the site sends, in rateLimits like any other budget.
const CODE_MAIL_BUDGET = "codeMail";

/** How much of Resend's day mail of `kind` may take: codes leave NOTICE_MAIL_RESERVE for notices. */
const dailyLimit = (kind: AccountMailKind): number =>
    kind === "code" ? RESEND_DAILY_CAP - NOTICE_MAIL_RESERVE : RESEND_DAILY_CAP;

/**
 * Sends one email straight away, skipping the overflow queue: it's no use to
 * someone waiting on a code half an hour later. A notice may use the whole
 * daily cap, so the reserve kept from bulk mail is what's left when a big send
 * has run; codes stop short of it, and at CODE_MAIL_HOURLY_CAP an hour.
 */
export async function sendAccountMail(envelope: ResendEnvelope, kind: AccountMailKind): Promise<void> {
    if (kind === "code" && !(await chargeRateLimit(CODE_MAIL_BUDGET, CODE_MAIL_HOURLY_CAP, HOUR_MS)).allowed) {
        throw mailUnavailable();
    }
    const allowed = await db.runTransaction(async (txn) => {
        const {sentToday, reserved} = await computeEmailQuotaInTxn(txn);
        if (sentToday >= dailyLimit(kind)) return false;
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

/**
 * Refuses as sending a code would when none could go out now, without sending
 * or using up anything: for a request that sends nothing, which has to be
 * refused alike or the difference gives away why it sent nothing.
 */
export async function requireCodeMailRoom(): Promise<void> {
    const [{sentToday}, roomThisHour] = await Promise.all([
        computeEmailQuotaDetail(),
        rateLimitHasRoom(CODE_MAIL_BUDGET, CODE_MAIL_HOURLY_CAP, HOUR_MS),
    ]);
    if (sentToday >= dailyLimit("code") || !roomThisHour) throw mailUnavailable();
}

/** For a heads-up after the fact: what it's about has happened, so a failure stops at the log. */
export async function sendNotice(envelope: ResendEnvelope): Promise<void> {
    try {
        await sendAccountMail(envelope, "notice");
    } catch (err) {
        console.error("sendNotice: not sent", err);
    }
}

const DAY_MS = 24 * HOUR_MS;

/**
 * Changes that each email the account a notice, and how many of each one account
 * may make a day. A notice may use all of the day's mail, the reserve kept from
 * codes included, so without these one account looping a change (binding and
 * unbinding Google, asking for deletion and cancelling) could spend the lot in
 * minutes, and the next change to anyone's account would go unannounced.
 */
const NOTICED_CHANGES_PER_DAY = {google: 6, password: 5, deletion: 3} as const;
export type NoticedChange = keyof typeof NOTICED_CHANGES_PER_DAY;

/**
 * Counts a change against its account's day, refusing it once over: refused,
 * never made without its notice. Goes after whatever proves the caller may make
 * the change, so nobody else can use up an account's allowance.
 */
export async function limitNoticedChange(uid: string, change: NoticedChange): Promise<void> {
    const {allowed, retryAfterMs} = await chargeRateLimit(
        `notice_${change}_${uid}`,
        NOTICED_CHANGES_PER_DAY[change],
        DAY_MS,
    );
    if (!allowed) {
        throw new HttpsError("resource-exhausted", "Too many changes like this today. Please try again later.", {
            code: "too-many-changes",
            retryAfterMs,
        });
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

/**
 * To the address an account has just left, which is how someone whose session
 * was stolen finds out. `undoUrl` is their way back without staff, on a change
 * the account's owner made; a change staff made has none.
 */
export async function emailChangedMail(
    to: string,
    newEmail: string,
    language: MailLanguage,
    undoUrl?: string,
): Promise<ResendEnvelope> {
    const masked = escapeHtml(maskEmail(newEmail));
    const contact = await contactLine(language);
    const link = undoUrl ? escapeHtml(undoUrl) : "";
    return language === "zh" ? {
        to,
        subject: "您的 Sekai Beyond 账号邮箱已更改",
        html: page("账号邮箱已更改", [
            `您的账号邮箱已更改为 ${masked}，此地址将不再用于登录。`,
            ...(link ? [`不是您本人的操作？<a href="${link}">撤销此更改</a>。链接在 ${EMAIL_UNDO_DAYS} 天内有效，会恢复此邮箱、退出所有设备并移除已绑定的 Google 账号。`] : []),
            contact,
        ]),
    } : {
        to,
        subject: "Your Sekai Beyond email has changed",
        html: page("Your email has changed", [
            `Your account's email is now ${masked}, and this address no longer signs in to it.`,
            ...(link ? [`Wasn't you? <a href="${link}">Undo this change</a>. The link works for ${EMAIL_UNDO_DAYS} days, and puts your account back on this address, signs out every device and removes any bound Google account.`] : []),
            contact,
        ]),
    };
}

/** To the address an undone change had moved to, which no longer signs in. */
export async function emailChangeUndoneMail(to: string, language: MailLanguage): Promise<ResendEnvelope> {
    const contact = await contactLine(language);
    return language === "zh" ? {
        to,
        subject: "您的 Sekai Beyond 邮箱更改已被撤销",
        html: page("邮箱更改已撤销", [
            "一个 Sekai Beyond 账号通过发送至原邮箱的链接撤销了邮箱更改，此地址将不再用于登录。",
            contact,
        ]),
    } : {
        to,
        subject: "Your Sekai Beyond email change was undone",
        html: page("Your email change was undone", [
            "An account's email change was undone from the link sent to its old address, and this address no longer signs in to it.",
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

/**
 * Whenever a Google account goes on or comes off an account. Being bound is a
 * way in that outlasts a password reset, so its owner has to hear about it.
 */
export async function googleChangedMail(
    to: string,
    googleEmail: string,
    bound: boolean,
    language: MailLanguage,
): Promise<ResendEnvelope> {
    const masked = escapeHtml(maskEmail(googleEmail));
    const contact = await contactLine(language);
    if (language === "zh") {
        return {
            to,
            subject: bound ? "您的 Sekai Beyond 账号绑定了 Google 账号" : "您的 Sekai Beyond 账号解绑了 Google 账号",
            html: page(bound ? "已绑定 Google 账号" : "已解绑 Google 账号", [
                bound
                    ? `Google 账号 ${masked} 已绑定到您的账号，现在可用它登录。可在“设置”中解绑。`
                    : `Google 账号 ${masked} 已从您的账号解绑，不再能用它登录。`,
                contact,
            ]),
        };
    }
    return {
        to,
        subject: bound ? "A Google account was bound to your Sekai Beyond account" : "A Google account was unbound from your Sekai Beyond account",
        html: page(bound ? "Google account bound" : "Google account unbound", [
            bound
                ? `The Google account ${masked} can now sign in to your account. You can unbind it in Settings.`
                : `The Google account ${masked} can no longer sign in to your account.`,
            contact,
        ]),
    };
}

/**
 * When an account asks for itself to be deleted, which anyone signed in to it can
 * do: its owner has until `deleteAt` to stop it from Settings. A deletion staff
 * asked for sends none, and only staff can cancel it.
 */
export async function accountDeletionMail(
    to: string,
    deleteAt: Date,
    language: MailLanguage,
): Promise<ResendEnvelope> {
    const settings = escapeHtml(`${PUBLIC_ORIGIN}/profile?tab=settings`);
    const contact = await contactLine(language);
    const when = escapeHtml(deleteAt.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: SITE_TIME_ZONE,
    }));
    return language === "zh" ? {
        to,
        subject: "您的 Sekai Beyond 账号即将被删除",
        html: page("账号即将被删除", [
            `有人在您的账号中申请了删除账号。自 ${when} 起，账号及其中的所有内容将被永久删除。`,
            `不是您本人的操作？请<a href="${settings}">登录并在“设置”中取消删除</a>，然后更改密码，以退出其他设备。无法登录时，可在登录窗口中使用“忘记密码”。`,
            contact,
        ]),
    } : {
        to,
        subject: "Your Sekai Beyond account is due to be deleted",
        html: page("Your account is due to be deleted", [
            `Someone signed in to your account asked for it to be deleted. From ${when}, it and everything in it will be gone for good.`,
            `Wasn't you? <a href="${settings}">Sign in and cancel it in Settings</a>, then change your password to sign out your other devices. If you can't sign in, use Forgot password.`,
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
