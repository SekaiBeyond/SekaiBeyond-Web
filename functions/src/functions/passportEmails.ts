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
import { type BatchOp, commitInChunks } from "../utils/helpers";
import {
    ACTIVATE_URL_PLACEHOLDER,
    ACTIVATION_CODE_PLACEHOLDER,
    fillActivationKey,
    MAX_EMAIL_COUNT,
    type MintingDesign,
    mintPassport,
    passportNoteRef,
    PASSPORTS,
    readMintingDesign,
    SECRETS,
    validatePassportNote,
} from "../utils/passports";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import { performer, recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, type ResendEnvelope, ResendSendError, sendEmails } from "../utils/resendClient";
import { validateDocId, validateEmail, validateStr } from "../utils/validation";
import { getScheduledMailQueueDepth } from "./scheduledMail";

const templateRef = () => db.collection("passportEmailTemplate").doc("default");

const carriesKey = (template: EmailTemplateDoc): boolean =>
    [template.subject, template.bodyHtml].some(t =>
        t.search(ACTIVATION_CODE_PLACEHOLDER) !== -1 || t.search(ACTIVATE_URL_PLACEHOLDER) !== -1);

function renderKeyEmail(
    template: string,
    data: {recipientEmail: string; design: MintingDesign; contactEmail: string},
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    const {design} = data;
    const cover = htmlContext && design.coverImageUrl
        ? `<img src="${escapeHtml(design.coverImageUrl)}" alt="${escapeHtml(design.name)}" width="200" style="display:block;margin:0 auto;width:200px;max-width:60%;height:auto;border:0;border-radius:8px;"/>`
        : "";
    return template
        .replace(/{{\s*recipientEmail\s*}}/g, () => sub(data.recipientEmail))
        .replace(/{{\s*designName\s*}}/g, () => sub(design.name))
        .replace(/{{\s*designNameCn\s*}}/g, () => sub(design.nameCn || design.name))
        .replace(/{{\s*year\s*}}/g, () => String(design.year))
        .replace(/{{\s*termDays\s*}}/g, () => String(design.termDays))
        .replace(/{{\s*passportCover\s*}}/g, () => cover)
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail));
}

export const emailPassports = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB", secrets: [RESEND_API_KEY]},
    async (request) => {
        const uid = await requireAuth(request, "staff");
        const callerSnap = await requireAdmin(uid);

        const input = request.data as {designId?: unknown; emails?: unknown; note?: unknown};
        const designId = validateDocId(input.designId, "designId");
        if (!Array.isArray(input.emails) || input.emails.length < 1 || input.emails.length > MAX_EMAIL_COUNT) {
            throw new HttpsError("invalid-argument", `emails must hold between 1 and ${MAX_EMAIL_COUNT} addresses.`);
        }
        const recipients = input.emails.map(e => validateEmail(e, "email"));
        const note = validatePassportNote(input.note);

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

        const ops: BatchOp[] = [];
        const outgoing: {email: string; passportId: string; envelope: ResendEnvelope}[] = [];
        const seen = new Set<string>();
        const by = {uid, name: performedByName};
        recipients.slice(0, sendCount + queueCount).forEach((email, i) => {
            const queued = i >= sendCount;
            const fields = {recipientEmail: email, design, contactEmail};
            const subject = subjectLine(renderKeyEmail(template.subject, fields, false));
            const html = renderKeyEmail(template.bodyHtml, fields, true);
            const {passportId, key, write, noteWrite} = mintPassport(design, seen, by, {
                sentTo: email,
                emailSentAt: queued ? null : FieldValue.serverTimestamp(),
                emailScheduled: queued,
            }, note);
            ops.push(write);
            if (noteWrite) ops.push(noteWrite);
            if (queued) {
                ops.push(batch => batch.set(db.collection("scheduledMail").doc(), {
                    type: "passport",
                    envelope: {to: email, subject, html},
                    queuedBy: uid,
                    queuedAt: FieldValue.serverTimestamp(),
                    recipientCount: 1,
                    targetPath: `${PASSPORTS}/${passportId}`,
                }));
            } else {
                outgoing.push({
                    email,
                    passportId,
                    envelope: {to: email, subject: fillActivationKey(subject, key), html: fillActivationKey(html, key)},
                });
            }
        });

        try {
            await commitInChunks(ops);
        } catch (err) {
            if (sendCount > 0) await rollbackQuotaReservation(sendCount);
            await Promise.all([sendAuditRef?.delete(), queueAuditRef?.delete()]);
            throw err;
        }

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
        const unsent = outgoing.slice(sentCount);
        if (unsent.length > 0) {
            try {
                await commitInChunks(unsent.map(({passportId}) => (batch) => {
                    batch.delete(db.collection(PASSPORTS).doc(passportId));
                    batch.delete(db.collection(SECRETS).doc(passportId));
                    batch.delete(passportNoteRef(passportId));
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

        return {sentCount, queuedCount: queueCount, deferred, failed: unsent.map(u => u.email)};
    });

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
            ...performer(uid, callerSnap),
        }));
        return {saved: true};
    });
});
