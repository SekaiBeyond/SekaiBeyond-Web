import sanitizeHtml from "sanitize-html";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { RESEND_QUEUE_CAP } from "../utils/config";
import { syncProviderUsage } from "../utils/emailProvider";
import {
    CONTACT_EMAIL_PLACEHOLDER,
    contactEmailFor,
    EMAIL_HTML_SANITIZE_OPTIONS,
    type EmailTemplateDoc,
    escapeHtml,
    readSavedTemplate,
    subjectLine,
} from "../utils/emailTemplate";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import {
    ACTIVATE_URL_PLACEHOLDER,
    ACTIVATION_CODE_PLACEHOLDER,
    fillActivationKey,
    MAX_EMAIL_COUNT,
    type MintingDesign,
    mintPassport,
    readMintingDesign,
} from "../utils/passports";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, type ResendEnvelope, ResendSendError, sendEmails } from "../utils/resendClient";
import { validateDocId, validateEmail, validateStr } from "../utils/validation";
import { getScheduledMailQueueDepth } from "./scheduledMail";

/**
 * Passports sent by email rather than printed: each address on an admin's list
 * gets a passport of its own, minted from one design, with its key in an email
 * from the one saved template. There is no sticker; once claimed, the holder
 * reaches the passport's page from their profile shelf.
 *
 * The address stays on the passport as `sentTo`, so sending a list again skips
 * whoever already has one of that design.
 */

const templateRef = () => db.collection("passportEmailTemplate").doc("default");

/** `in` takes at most 30 values. */
const IN_QUERY_LIMIT = 30;

/**
 * A key email that carries neither the key nor its link would be a passport no
 * one can claim.
 */
const carriesKey = (template: EmailTemplateDoc): boolean =>
    [template.subject, template.bodyHtml].some(t =>
        t.search(ACTIVATION_CODE_PLACEHOLDER) !== -1 || t.search(ACTIVATE_URL_PLACEHOLDER) !== -1);

/**
 * Everything in a key email but the key, which fillActivationKey adds. False
 * for the subject line, where entities would show literally and the cover has
 * no place.
 */
function renderKeyEmail(
    template: string,
    data: {recipientEmail: string; design: MintingDesign; contactEmail: string},
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    const {design} = data;
    // A real <img>, since email clients ignore CSS backgrounds. Nothing for a
    // design without cover art.
    const cover = htmlContext && design.coverImageUrl
        ? `<img src="${escapeHtml(design.coverImageUrl)}" alt="${escapeHtml(design.name)}" width="200" style="display:block;margin:0 auto;width:200px;max-width:60%;height:auto;border:0;border-radius:8px;"/>`
        : "";
    // Function replacements throughout: a replacement string would read $&, $'
    // and $$ in a name as patterns.
    return template
        .replace(/{{\s*recipientEmail\s*}}/g, () => sub(data.recipientEmail))
        .replace(/{{\s*designName\s*}}/g, () => sub(design.name))
        .replace(/{{\s*designNameCn\s*}}/g, () => sub(design.nameCn || design.name))
        .replace(/{{\s*year\s*}}/g, () => String(design.year))
        .replace(/{{\s*termDays\s*}}/g, () => String(design.termDays))
        .replace(/{{\s*passportCover\s*}}/g, () => cover)
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail));
}

/**
 * Mint one passport per address and email each its key, up to MAX_EMAIL_COUNT
 * addresses a call; the client splits longer lists.
 *
 * What the daily cap leaves room for goes now, the overflow joins
 * /scheduledMail as sendTicketEmails' does, and anything past the queue's cap
 * comes back in `deferred`, minting nothing, for another day. Addresses that
 * already have a passport of the design come back in `skipped`, and those whose
 * email Resend refused in `failed`. Only passports whose email went or is
 * queued are kept, so a failed address can simply be sent again.
 */
export const emailPassports = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB", secrets: [RESEND_API_KEY]},
    async (request) => {
        const uid = await requireAuth(request, "staff");
        const callerSnap = await requireAdmin(uid);

        const input = request.data as {designId?: unknown; emails?: unknown};
        const designId = validateDocId(input.designId, "designId");
        if (!Array.isArray(input.emails) || input.emails.length < 1 || input.emails.length > MAX_EMAIL_COUNT) {
            throw new HttpsError("invalid-argument", `emails must hold between 1 and ${MAX_EMAIL_COUNT} addresses.`);
        }
        // Lowercased, and each address once however often it's listed.
        const emails = [...new Set(input.emails.map(e => validateEmail(e, "email")))];

        const [design, template] = await Promise.all([
            readMintingDesign(designId),
            readSavedTemplate(templateRef()),
        ]);
        if (!carriesKey(template)) {
            throw new HttpsError("failed-precondition",
                "The template has neither {{ activationCode }} nor {{ activateUrl }}, so no one could claim the passport.",
                {code: "no-key-placeholder"});
        }
        const contactEmail = await contactEmailFor(template);

        // Queried by address alone and narrowed to the design here, so no
        // composite index is needed.
        const alreadySent = new Set<string>();
        for (let i = 0; i < emails.length; i += IN_QUERY_LIMIT) {
            const snap = await db.collection("passports")
                .where("sentTo", "in", emails.slice(i, i + IN_QUERY_LIMIT))
                .get();
            for (const doc of snap.docs) {
                if (doc.data().designId === designId) alreadySent.add(doc.data().sentTo);
            }
        }
        const skipped = emails.filter(e => alreadySent.has(e));
        const recipients = emails.filter(e => !alreadySent.has(e));
        if (recipients.length === 0) return {sentCount: 0, queuedCount: 0, skipped, deferred: [], failed: []};

        // The daily cap, gated as in sendTicketEmails: re-anchored against the
        // provider first, then a pre-check that only refuses when both the cap
        // and the queue are full; the transaction below has the final word.
        await syncProviderUsage();
        const {sentToday, dailyCap} = await computeEmailQuota();
        const queueCapacity = Math.max(0, RESEND_QUEUE_CAP - await getScheduledMailQueueDepth());
        if (sentToday >= dailyCap && queueCapacity === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily cap reached and overflow queue is full.", {code: "quota-exceeded"});
        }

        const performedByName: string = callerSnap.data()?.displayName ?? "";
        const recordFields = {
            performedBy: uid,
            performedByName,
            passportDesignName: design.name,
            passportYear: design.year,
        };
        // Reserved in a transaction with the records, so two sends can't both
        // spend the same slots.
        const {sendCount, queueCount, sendAuditRef, queueAuditRef} = await db.runTransaction(async (txn) => {
            const {sentToday: freshSent, dailyCap: freshCap, reserved} = await computeEmailQuotaInTxn(txn);
            const sendCount = Math.min(recipients.length, Math.max(0, freshCap - freshSent));
            const queueCount = Math.min(recipients.length - sendCount, queueCapacity);
            let sendAuditRef: FirebaseFirestore.DocumentReference | null = null;
            let queueAuditRef: FirebaseFirestore.DocumentReference | null = null;
            if (sendCount > 0) {
                reserveQuotaInTxn(txn, sendCount, reserved);
                sendAuditRef = recordRef();
                txn.set(sendAuditRef, recordDoc("passport-email-send", {...recordFields, passportCount: sendCount}));
            }
            if (queueCount > 0) {
                queueAuditRef = recordRef();
                txn.set(queueAuditRef, recordDoc("passport-email-queue", {...recordFields, passportCount: queueCount}));
            }
            return {sendCount, queueCount, sendAuditRef, queueAuditRef};
        });
        const deferred = recipients.slice(sendCount + queueCount);

        const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
        const outgoing: {email: string; passportId: string; envelope: ResendEnvelope}[] = [];
        const seen = new Set<string>();
        const by = {uid, name: performedByName};
        recipients.slice(0, sendCount + queueCount).forEach((email, i) => {
            const queued = i >= sendCount;
            const fields = {recipientEmail: email, design, contactEmail};
            const subject = subjectLine(renderKeyEmail(template.subject, fields, false));
            const html = renderKeyEmail(template.bodyHtml, fields, true);
            const {passportId, key, write} = mintPassport(design, seen, by, {
                sentTo: email,
                // Set ahead of the send: a passport whose email doesn't go is
                // deleted below.
                emailSentAt: queued ? null : FieldValue.serverTimestamp(),
                // The admin screens say "Queued" until scheduledMailDrain
                // ships it.
                emailScheduled: queued,
            });
            ops.push(write);
            if (queued) {
                // Without the key: the drain fills it in from passportSecrets,
                // so the queue, which core staff can read, never holds one, and
                // a key reissued meanwhile is the one that goes.
                ops.push(batch => batch.set(db.collection("scheduledMail").doc(), {
                    type: "passport",
                    envelope: {to: email, subject, html},
                    queuedBy: uid,
                    queuedAt: FieldValue.serverTimestamp(),
                    recipientCount: 1,
                    targetPath: `passports/${passportId}`,
                }));
            } else {
                outgoing.push({
                    email,
                    passportId,
                    envelope: {to: email, subject: fillActivationKey(subject, key), html: fillActivationKey(html, key)},
                });
            }
        });

        // Two writes a passport and one a queued email stay within one batch,
        // so this lands whole or not at all.
        try {
            await commitInChunks(ops);
        } catch (err) {
            // Nothing has gone out, so nothing is kept.
            if (sendCount > 0) await rollbackQuotaReservation(sendCount);
            await Promise.all([sendAuditRef?.delete(), queueAuditRef?.delete()]);
            throw err;
        }

        // One Resend call, all or nothing; the pre-charge is rolled back on
        // failure unless a quota header came back, which resendClient has
        // already recorded.
        let sentCount = 0;
        if (outgoing.length > 0) {
            try {
                sentCount = (await sendEmails(outgoing.map(o => o.envelope))).sentCount;
            } catch (err) {
                console.error("emailPassports: send failed", err);
                const headerArrived = err instanceof ResendSendError && err.dailyConsumed !== null;
                if (!headerArrived) await rollbackQuotaReservation(sendCount);
            }
        }
        if (sentCount > outgoing.length) {
            console.error("emailPassports: Resend returned more ids than envelopes sent",
                sentCount, outgoing.length);
            sentCount = outgoing.length;
        }

        // A passport whose email didn't go is deleted, key and all: no one has
        // seen its key, and its address is free to be sent one again.
        const unsent = outgoing.slice(sentCount);
        if (unsent.length > 0) {
            try {
                await commitInChunks(unsent.map(({passportId}) => (batch) => {
                    batch.delete(db.collection("passports").doc(passportId));
                    batch.delete(db.collection("passportSecrets").doc(passportId));
                }));
            } catch (err) {
                console.error("emailPassports: failed to delete passports whose email didn't go",
                    unsent.map(u => u.passportId), err);
            }
        }
        if (sendAuditRef) {
            if (sentCount === 0) await sendAuditRef.delete();
            else if (sentCount !== sendCount) await sendAuditRef.update({passportCount: sentCount});
        }

        return {sentCount, queuedCount: queueCount, skipped, deferred, failed: unsent.map(u => u.email)};
    });

/** Save the one key email template. Core staff and up, like the ticket template. */
export const updatePassportEmailTemplate = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {subject?: unknown; bodyHtml?: unknown};
    const subject = validateStr(input.subject, "subject", 500, true);
    const bodyHtml = sanitizeHtml(validateStr(input.bodyHtml, "bodyHtml", 20000), EMAIL_HTML_SANITIZE_OPTIONS);

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(templateRef(), {
            subject, bodyHtml,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("passport-email-template-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
        }));
        return {saved: true};
    });
});
