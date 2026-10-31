import type { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { CONTACT_EMAIL_PLACEHOLDER, type EmailTemplateDoc, escapeHtml, subjectLine } from "./emailTemplate";
import { type ResendEnvelope } from "./resendClient";
import { SITE_TIME_ZONE } from "./siteTime";
import { walletPassUrl } from "./tickets";

/**
 * The ticket email: an event's saved template filled in for one attendee, with
 * a QR code per ticket. Staff sends (sendTicketEmails) and orders placed
 * through the ticket API that ask for it render it the same way.
 */

/** Where an event's saved ticket email lives, under its upcomingEvents doc. */
export const ticketTemplateRef = (eventRef: FirebaseFirestore.DocumentReference) =>
    eventRef.collection("emailTemplate").doc("default");

export function formatEventDateForEmail(startAt: Timestamp | undefined): string {
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

export const ticketIdOf = (ticket: any): string =>
    typeof ticket === "string" ? ticket : (ticket?.ticketId ?? "");

/**
 * How a ticket's type shows: its label, the email pill's colour, and on its
 * wallet pass, a colour (one of WalletWallet's free-plan presets) and a label
 * short enough for the top-right corner, where a long one is cut off. An early
 * bird's pass is coloured as the general admission it's a cheaper kind of.
 */
export function ticketTypeStyle(ticket: any): {
    label: string;
    bgColor: string;
    walletColor: string;
    walletLabel: string
} {
    const typeRaw = typeof ticket === "string" ? "normal" : (ticket?.type ?? "normal");
    if (typeRaw === "early-bird-student" || typeRaw === "earlybirdstudent") {
        return {label: "Early Bird Student", bgColor: "#8e44ad", walletColor: "purple", walletLabel: "Student EB"}; // deep purple
    } else if (typeRaw === "early-bird" || typeRaw === "earlybird") {
        return {label: "Early Bird", bgColor: "#1abc9c", walletColor: "blue", walletLabel: "General EB"}; // teal
    } else if (typeRaw === "student" || typeRaw === "学生") {
        return {label: "Student", bgColor: "#9b59b6", walletColor: "purple", walletLabel: "Student"}; // purple
    } else if (typeRaw === "vip") {
        return {label: "VIP", bgColor: "#f39c12", walletColor: "red", walletLabel: "VIP"}; // gold
    } else if (typeRaw === "guest" || typeRaw === "嘉宾") {
        return {label: "Guest", bgColor: "#3498db", walletColor: "orange", walletLabel: "Guest"}; // blue
    } else if (typeRaw === "Comp Ticket" || typeRaw === "comp" || typeRaw === "赠票") {
        return {label: "Comp Ticket", bgColor: "#95a5a6", walletColor: "dark", walletLabel: "Comp"}; // gray
    } else if (typeRaw === "vendor" || typeRaw === "商摊") {
        return {label: "Vendor", bgColor: "#d35400", walletColor: "green", walletLabel: "Vendor"}; // burnt orange
    }
    return {label: "General Admission", bgColor: "#ff6b9d", walletColor: "blue", walletLabel: "General"}; // brand pink
}

function renderTicketQrBlock(tickets: any[], eventId: string, walletPass: boolean): string {
    // One <div> per ticket. Images reference the serverless QR generation endpoint.
    return tickets.map((ticket, i) => {
        const id = ticketIdOf(ticket);
        const {label: typeLabel, bgColor} = ticketTypeStyle(ticket);

        const qrUrl = `${PUBLIC_ORIGIN}/api/ticket-qr?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        // On every ticket while the event's passes are on; the pass is made when
        // it's first opened (serveWalletPass).
        const walletButton = walletPass
            ? `<div style="margin-top:12px;"><a href="${escapeHtml(walletPassUrl(id, eventId))}" style="display:inline-block;background-color:#000000;color:#ffffff;font-weight:bold;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;">Add to Wallet</a></div>`
            : "";
        // A wide gap so framing one code doesn't also catch its neighbour.
        return `<div style="margin:${i === 0 ? 16 : 72}px 0 16px;text-align:center;">` +
            `<div style="display:inline-block;background-color:${bgColor};color:#ffffff;font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">${typeLabel}</div><br/>` +
            `<img src="${qrUrl}" alt="Ticket ${id}" width="300" height="300" style="width:300px;max-width:100%;height:auto;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            walletButton +
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
 * already left out; `walletPass` gives each an Add to Wallet button (see
 * walletPassesOnFor).
 */
export function renderTicketEmail(
    template: EmailTemplateDoc,
    contactEmail: string,
    event: {id: string; data: FirebaseFirestore.DocumentData},
    attendee: {name?: string; email: string},
    tickets: any[],
    walletPass: boolean,
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
        html: renderTemplate(template.bodyHtml, {
            ...fields,
            ticketBlock: renderTicketQrBlock(tickets, event.id, walletPass)
        }, true),
    };
}
