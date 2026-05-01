import { Timestamp } from 'firebase/firestore';
import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { AttendeeData, EmailTemplate, TicketData } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_TEMPLATE_SUBJECT = 'Your tickets for {{ eventTitle }}';

export const DEFAULT_TEMPLATE_BODY_EN = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    {{ eventHeader }}

    <div style="padding:32px 24px;">
        <h2 style="margin:0 0 16px;color:#2a2a2a;font-size:20px;font-weight:600;">Hi {{attendeeName}},</h2>
        <p style="margin:0 0 24px;color:#4a4a4a;font-size:16px;line-height:1.6;">You're officially confirmed
            for <strong>{{eventTitle}}</strong>. We can't wait to see you there!</p>

        <div
            style="background-color:#f9f9f9;border-left:4px solid #ff6b9d;border-radius:4px;padding:20px;margin-bottom:32px;">
            <table style="width:100%;border-collapse:collapse;">
                <tr>
                    <td style="padding:0 0 12px;font-size:14px;color:#666666;width:80px;vertical-align:top;">Date</td>
                    <td style="padding:0 0 12px;font-size:15px;color:#2a2a2a;font-weight:600;">{{eventDate}}</td>
                </tr>
                <tr>
                    <td style="padding:0;font-size:14px;color:#666666;width:80px;vertical-align:top;">Tickets</td>
                    <td style="padding:0;font-size:15px;color:#2a2a2a;font-weight:600;">{{ticketCount}}</td>
                </tr>
            </table>
        </div>

        <div style="text-align:center;margin-bottom:32px;">
            <p style="margin:0 0 16px;color:#4a4a4a;font-size:15px;font-weight:500;">Please present the QR code(s)
                below at the door for scanning.</p>
            {{ticketIds[]}}
        </div>

        <hr style="border:none;border-top:1px solid #eaeaea;margin:32px 0;"/>

        <div style="background-color:#fff0f6;border-radius:8px;padding:20px;">
            <p style="margin:0 0 12px;color:#ff6b9d;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Important
                Reminders</p>
            <ul style="margin:0;padding-left:20px;color:#4a4a4a;font-size:14px;line-height:1.6;">
                <li style="margin-bottom:8px;">Each QR code is valid for <strong>one entry only</strong>. Please do
                    not share or post them publicly.
                </li>
                <li style="margin-bottom:8px;">Screenshots work perfectly fine &mdash; just ensure your phone is
                    charged.
                </li>
                <li>Having trouble at the door? Simply contact us at <strong><a
                    href="mailto:sekaibeyond@outlook.com"
                    style="color:#ff6b9d;text-decoration:none;">sekaibeyond@outlook.com</a></strong> and we'll sort
                    it out.
                </li>
            </ul>
        </div>

        <p style="margin:32px 0 0;color:#4a4a4a;font-size:15px;line-height:1.6;">See you soon,<br/><strong
            style="color:#2a2a2a;">The Sekai Beyond Team</strong></p>
    </div>
</div>`;

export const tsToDate = (t: unknown): Date | null => {
    if (!t) return null;
    if (t instanceof Timestamp) return t.toDate();
    if (t instanceof Date) return t;
    return null;
};

export const mapAttendeeDoc = (
    id: string,
    data: Record<string, unknown>,
): AttendeeData => {
    const rawTickets = Array.isArray(data.tickets) ? data.tickets : [];
    const tickets: TicketData[] = rawTickets.map((t) => {
        const tk = t as Record<string, unknown>;
        return {
            ticketId: (tk.ticketId as string) ?? '',
            type: (tk.type as any) ?? 'normal',
            createdAt: tsToDate(tk.createdAt),
            redeemed: (tk.redeemed as boolean) ?? false,
            redeemedAt: tsToDate(tk.redeemedAt),
            redeemedBy: (tk.redeemedBy as string) ?? '',
            redeemedByName: (tk.redeemedByName as string) ?? '',
            checkedIn: (tk.checkedIn as boolean) ?? false,
            checkedInAt: tsToDate(tk.checkedInAt),
            voided: (tk.voided as boolean) ?? false,
        };
    });
    return {
        id,
        email: (data.email as string) ?? '',
        name: (data.name as string) ?? '',
        ticketCount: (data.ticketCount as number) ?? 0,
        emailSent: (data.emailSent as boolean) ?? false,
        emailSentAt: tsToDate(data.emailSentAt),
        createdAt: tsToDate(data.createdAt) ?? new Date(),
        updatedAt: tsToDate(data.updatedAt) ?? new Date(),
        tickets,
        ticketIds: Array.isArray(data.ticketIds) ? (data.ticketIds as string[]) : [],
    };
};

export const ticketStatusCounts = (a: AttendeeData) => {
    let used = 0;
    let voided = 0;
    for (const t of a.tickets) {
        if (t.voided) voided++;
        else if (t.redeemed) used++;
    }
    return {used, voided, remaining: a.ticketCount - used - voided};
};

export const renderSamplePreview = (template: EmailTemplate, event: UpcomingEvent): string => {
    const sampleData = {
        attendeeEmail: 'sample@example.com',
        attendeeName: 'Sample Attendee',
        eventTitle: event.title,
        eventTitleCn: event.titleCn,
        eventDate: event.startAt.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }),
        ticketCount: 2,
        headerImage: event.emailHeaderBg
            ? `<img src="${event.emailHeaderBg}" alt="${event.title}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
            : `<div style="background-color:#ff6b9d;height:120px;"></div>`,
    };
    const ticketBlock = `<div style="padding:16px;border:1px dashed #aaa;text-align:center;margin:12px 0;">` +
        `<strong>[QR for each ticket rendered here at send time]</strong><br/><br/>` +
        `<div style="display:inline-block;background-color:#ff6b9d;color:#ffffff;font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px;">General Admission</div><br/>` +
        `<code>ticket-uuid-1</code><br/><br/>` +
        `<div style="display:inline-block;background-color:#f39c12;color:#ffffff;font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px;">VIP</div><br/>` +
        `<code>ticket-uuid-2</code></div>`;
    const render = (tpl: string) => tpl
        .replace(/{{\s*attendeeEmail\s*}}/g, sampleData.attendeeEmail)
        .replace(/{{\s*attendeeName\s*}}/g, sampleData.attendeeName)
        .replace(/{{\s*eventTitle\s*}}/g, sampleData.eventTitle)
        .replace(/{{\s*eventTitleCn\s*}}/g, sampleData.eventTitleCn)
        .replace(/{{\s*eventDate\s*}}/g, sampleData.eventDate)
        .replace(/{{\s*ticketCount\s*}}/g, String(sampleData.ticketCount))
        .replace(/{{\s*eventHeader\s*}}/g, sampleData.headerImage)
        .replace(/{{\s*eventHeaderBgStyle\s*}}/g, '')
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[\]\s*}}(\s*<\/p>|\s*<\/div>)?/g, ticketBlock);
    const en = render(template.bodyHtml);
    const cn = render(template.bodyCnHtml);
    const hr = `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;"/>`;
    // Sanitize with the same allowlist the server applies at save time so the
    // admin never sees content that wouldn't survive the save.
    return sanitizeEmailHtml(cn ? `${en}${hr}${cn}` : en);
};
