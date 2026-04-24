import { Timestamp } from 'firebase/firestore';
import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { AttendeeData, EmailTemplate, TicketData } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_TEMPLATE_SUBJECT = 'Your tickets for {{ eventTitle }}';

export const DEFAULT_TEMPLATE_BODY_EN = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2a2a2a;line-height:1.6;">
  <h2 style="margin:0 0 16px;color:#ff6b9d;font-weight:600;">Hi {{ attendeeName }},</h2>

  <p>You're confirmed for <strong>{{ eventTitle }}</strong>. We can't wait to see you there!</p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#fff0f6;border:1px solid #ffd9e6;border-radius:10px;">
    <tr>
      <td style="padding:12px 18px;font-size:14px;color:#777;width:90px;">Date</td>
      <td style="padding:12px 18px;font-size:14px;"><strong>{{ eventDate }}</strong></td>
    </tr>
    <tr>
      <td style="padding:12px 18px;font-size:14px;color:#777;border-top:1px solid #ffd9e6;">Tickets</td>
      <td style="padding:12px 18px;font-size:14px;border-top:1px solid #ffd9e6;"><strong>{{ ticketCount }}</strong></td>
    </tr>
  </table>

  <p>Please show the QR code(s) below at the door &mdash; one scan per ticket.</p>

  {{ ticketIds[] }}

  <p style="font-size:13px;color:#666;margin-top:28px;"><strong>A few reminders:</strong></p>
  <ul style="font-size:13px;color:#666;padding-left:20px;margin:8px 0;">
    <li>Each QR code is valid for one entry only &mdash; please don't share or post them publicly.</li>
    <li>Screenshots work fine; just keep your phone charged.</li>
    <li>Trouble at the door? Just reply to this email and we'll sort it out.</li>
  </ul>

  <p style="margin-top:28px;">See you soon,<br/><strong>The Sekai Beyond team</strong></p>
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
    };
    const ticketBlock = `<div style="padding:16px;border:1px dashed #aaa;text-align:center;margin:12px 0;">` +
        `<strong>[QR for each ticket rendered here at send time]</strong><br/>` +
        `<code>ticket-uuid-1</code><br/><code>ticket-uuid-2</code></div>`;
    const render = (tpl: string) => tpl
        .replace(/{{\s*attendeeEmail\s*}}/g, sampleData.attendeeEmail)
        .replace(/{{\s*attendeeName\s*}}/g, sampleData.attendeeName)
        .replace(/{{\s*eventTitle\s*}}/g, sampleData.eventTitle)
        .replace(/{{\s*eventTitleCn\s*}}/g, sampleData.eventTitleCn)
        .replace(/{{\s*eventDate\s*}}/g, sampleData.eventDate)
        .replace(/{{\s*ticketCount\s*}}/g, String(sampleData.ticketCount))
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[\]\s*}}(\s*<\/p>|\s*<\/div>)?/g, ticketBlock);
    const en = render(template.bodyHtml);
    const cn = render(template.bodyCnHtml);
    const hr = `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;"/>`;
    // Sanitize with the same allowlist the server applies at save time so the
    // admin never sees content that wouldn't survive the save.
    return sanitizeEmailHtml(cn ? `${en}${hr}${cn}` : en);
};
