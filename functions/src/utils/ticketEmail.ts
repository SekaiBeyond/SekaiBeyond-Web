import type { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { CONTACT_EMAIL_PLACEHOLDER, type EmailTemplateDoc, escapeHtml, subjectLine } from "./emailTemplate";
import { type ResendEnvelope } from "./resendClient";
import { SITE_TIME_ZONE } from "./siteTime";

/**
 * The ticket email: an event's saved template filled in for one attendee, with
 * a QR code per ticket. Staff sends (sendTicketEmails) and orders placed
 * through the ticket API that ask for it render it the same way.
 */

/** Where an event's saved ticket email lives, under its upcomingEvents doc. */
export const ticketTemplateRef = (eventRef: FirebaseFirestore.DocumentReference) =>
    eventRef.collection("emailTemplate").doc("default");

function formatEventDateForEmail(startAt: Timestamp | undefined): string {
    if (!startAt) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: SITE_TIME_ZONE,
            year: "numeric", month: "long", day: "numeric",
            hour: "numeric", minute: "2-digit",
            // "PT", so an attendee reading it elsewhere doesn't take it for their own clock.
            timeZoneName: "shortGeneric",
        }).format(startAt.toDate());
    } catch {
        return "";
    }
}

function renderTicketQrBlock(tickets: any[], eventId: string): string {
    // One <div> per ticket. Images reference the serverless QR generation endpoint.
    return tickets.map((ticket, i) => {
        const id = typeof ticket === "string" ? ticket : (ticket.ticketId ?? "");
        const typeRaw = typeof ticket === "string" ? "normal" : (ticket.type ?? "normal");

        let typeLabel = "General Admission";
        let bgColor = "#ff6b9d"; // brand pink

        if (typeRaw === "early-bird-student" || typeRaw === "earlybirdstudent") {
            typeLabel = "Early Bird Student";
            bgColor = "#8e44ad"; // deep purple
        } else if (typeRaw === "early-bird" || typeRaw === "earlybird") {
            typeLabel = "Early Bird";
            bgColor = "#1abc9c"; // teal
        } else if (typeRaw === "student" || typeRaw === "学生") {
            typeLabel = "Student";
            bgColor = "#9b59b6"; // purple
        } else if (typeRaw === "vip") {
            typeLabel = "VIP";
            bgColor = "#f39c12"; // gold
        } else if (typeRaw === "guest" || typeRaw === "嘉宾") {
            typeLabel = "Guest";
            bgColor = "#3498db"; // blue
        } else if (typeRaw === "Comp Ticket" || typeRaw === "comp" || typeRaw === "赠票") {
            typeLabel = "Comp Ticket";
            bgColor = "#95a5a6"; // gray
        } else if (typeRaw === "vendor" || typeRaw === "商摊") {
            typeLabel = "Vendor";
            bgColor = "#d35400"; // burnt orange
        }

        const qrUrl = `${PUBLIC_ORIGIN}/api/ticket-qr?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        // A wide gap so framing one code doesn't also catch its neighbour.
        return `<div style="margin:${i === 0 ? 16 : 72}px 0 16px;text-align:center;">` +
            `<div style="display:inline-block;background-color:${bgColor};color:#ffffff;font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">${typeLabel}</div><br/>` +
            `<img src="${qrUrl}" alt="Ticket ${id}" width="300" height="300" style="width:300px;max-width:100%;height:auto;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            `</div>`;
    }).join("\n");
}

function renderTemplate(
    template: string,
    data: {
        attendeeEmail: string;
        attendeeName: string;
        eventTitle: string;
        eventTitleCn: string;
        eventDate: string;
        emailHeaderBg: string;
        ticketCount: number;
        ticketBlock: string;
        contactEmail: string;
    },
    // False for the subject line, where entities would show literally ("Jones
    // &amp; Co").
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    // A real <img>, since email clients strip or ignore CSS backgrounds. The URL
    // was validated at save time, but against its parsed form, so the stored
    // string is escaped too.
    const headerImage = data.emailHeaderBg
        ? `<img src="${escapeHtml(data.emailHeaderBg)}" alt="${sub(data.eventTitle)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        : `<div style="background-color:#ff6b9d;height:120px;"></div>`;

    // Function replacements throughout: a replacement string would read $&, $'
    // and $$ in a name or title as patterns.
    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, () => sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, () => sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, () => sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, () => sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, () => sub(data.eventDate))
        .replace(/{{\s*eventHeader\s*}}/g, () => headerImage)
        .replace(/{{\s*ticketCount\s*}}/g, () => String(data.ticketCount))
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail))
        // {{ ticketIds[] }}, with a wrapping <p>/<div> collapsed. ticketBlock is
        // server-built HTML, never escaped.
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[]\s*}}(\s*<\/p>|\s*<\/div>)?/g, () => data.ticketBlock);
}

/**
 * One attendee's ticket email. `tickets` are the ones to send, voided ones
 * already left out.
 */
export function renderTicketEmail(
    template: EmailTemplateDoc,
    contactEmail: string,
    event: {id: string; data: FirebaseFirestore.DocumentData},
    attendee: {name?: string; email: string},
    tickets: any[],
): ResendEnvelope {
    const fields = {
        attendeeEmail: attendee.email,
        // The name is optional, so "Hi {{attendeeName}}," falls back to the
        // address rather than reading "Hi ,".
        attendeeName: attendee.name || attendee.email,
        eventTitle: event.data.title ?? "",
        eventTitleCn: event.data.titleCn ?? "",
        eventDate: formatEventDateForEmail(event.data.startAt),
        emailHeaderBg: event.data.emailHeaderBg ?? "",
        ticketCount: tickets.length,
        contactEmail,
    };
    return {
        to: attendee.email,
        // subjectLine, so a newline in eventTitle or attendeeName can't inject
        // headers.
        subject: subjectLine(renderTemplate(template.subject, {...fields, ticketBlock: ""}, false)),
        html: renderTemplate(template.bodyHtml, {...fields, ticketBlock: renderTicketQrBlock(tickets, event.id)}, true),
    };
}
