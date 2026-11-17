import type { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { CONTACT_EMAIL_PLACEHOLDER, type EmailTemplateDoc, escapeHtml, subjectLine } from "./emailTemplate";
import { type ResendEnvelope } from "./resendClient";
import { SITE_TIME_ZONE } from "./siteTime";
import { type NewTicket, walletPassUrl } from "./tickets";

export const ticketTemplateRef = (eventRef: FirebaseFirestore.DocumentReference) =>
    eventRef.collection("emailTemplate").doc("default");

export function formatEventDateForEmail(startAt: Timestamp | undefined): string {
    if (!startAt) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: SITE_TIME_ZONE,
            year: "numeric", month: "long", day: "numeric",
            hour: "numeric", minute: "2-digit",
            timeZoneName: "shortGeneric",
        }).format(startAt.toDate());
    } catch {
        return "";
    }
}

export function ticketTypeStyle(ticket: Partial<NewTicket>): {
    label: string;
    bgColor: string;
    walletColor: string;
    walletLabel: string
} {
    switch (ticket.type) {
        case "early-bird-student":
            return {label: "Early Bird Student", bgColor: "#8e44ad", walletColor: "purple", walletLabel: "Student EB"};
        case "early-bird":
            return {label: "Early Bird", bgColor: "#1abc9c", walletColor: "blue", walletLabel: "General EB"};
        case "student":
            return {label: "Student", bgColor: "#9b59b6", walletColor: "purple", walletLabel: "Student"};
        case "vip":
            return {label: "VIP", bgColor: "#f39c12", walletColor: "red", walletLabel: "VIP"};
        case "guest":
            return {label: "Guest", bgColor: "#3498db", walletColor: "orange", walletLabel: "Guest"};
        case "Comp Ticket":
            return {label: "Comp Ticket", bgColor: "#95a5a6", walletColor: "dark", walletLabel: "Comp"};
        case "vendor":
            return {label: "Vendor", bgColor: "#d35400", walletColor: "green", walletLabel: "Vendor"};
        default:
            return {label: "General Admission", bgColor: "#ff6b9d", walletColor: "blue", walletLabel: "General"};
    }
}

function renderTicketQrBlock(tickets: Partial<NewTicket>[], eventId: string, walletPass: boolean): string {
    return tickets.map((ticket, i) => {
        const id = ticket.ticketId ?? "";
        const {label: typeLabel, bgColor} = ticketTypeStyle(ticket);

        const qrUrl = `${PUBLIC_ORIGIN}/api/ticket-qr?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        const walletButton = walletPass
            ? `<div style="margin-top:12px;"><a href="${escapeHtml(walletPassUrl(id, eventId))}" style="display:inline-block;background-color:#000000;color:#ffffff;font-weight:bold;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;">Add to Wallet</a></div>`
            : "";
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
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    const headerImage = data.emailHeaderBg
        ? `<img src="${escapeHtml(data.emailHeaderBg)}" alt="${sub(data.eventTitle)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        : `<div style="background-color:#ff6b9d;height:120px;"></div>`;

    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, () => sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, () => sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, () => sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, () => sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, () => sub(data.eventDate))
        .replace(/{{\s*eventHeader\s*}}/g, () => headerImage)
        .replace(/{{\s*ticketCount\s*}}/g, () => String(data.ticketCount))
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail))
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[]\s*}}(\s*<\/p>|\s*<\/div>)?/g, () => data.ticketBlock);
}

export function renderTicketEmail(
    template: EmailTemplateDoc,
    contactEmail: string,
    event: {id: string; data: FirebaseFirestore.DocumentData},
    attendee: {name?: string; email: string},
    tickets: Partial<NewTicket>[],
    walletPass: boolean,
): ResendEnvelope {
    const fields = {
        attendeeEmail: attendee.email,
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
        subject: subjectLine(renderTemplate(template.subject, {...fields, ticketBlock: ""}, false)),
        html: renderTemplate(template.bodyHtml, {
            ...fields,
            ticketBlock: renderTicketQrBlock(tickets, event.id, walletPass)
        }, true),
    };
}
