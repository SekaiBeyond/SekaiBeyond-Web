import * as crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";

export const SELLABLE_TICKET_TYPES = ["normal", "early-bird", "student", "early-bird-student", "vip"];

export const TICKET_TYPES = [...SELLABLE_TICKET_TYPES, "Comp Ticket", "guest", "vendor"];

export interface NewTicket {
    ticketId: string;
    type: string;
    createdAt: Timestamp;
    redeemed: boolean;
    redeemedAt: Timestamp | null;
    redeemedBy: string;
    redeemedByName: string;
    checkedIn: boolean;
    checkedInAt: Timestamp | null;
    voided: boolean;
    notes?: string;
}

export function freshTicket(ticketId: string, type: string): NewTicket {
    return {
        ticketId,
        type,
        createdAt: Timestamp.now(),
        redeemed: false,
        redeemedAt: null,
        redeemedBy: "",
        redeemedByName: "",
        checkedIn: false,
        checkedInAt: null,
        voided: false,
    };
}

export function buildFreshTickets(count: number, type = "normal", notes = ""): {
    tickets: NewTicket[];
    ticketIds: string[]
} {
    const tickets: NewTicket[] = [];
    const ticketIds: string[] = [];
    for (let i = 0; i < count; i++) {
        const ticketId = crypto.randomUUID();
        ticketIds.push(ticketId);
        tickets.push(notes ? {...freshTicket(ticketId, type), notes} : freshTicket(ticketId, type));
    }
    return {tickets, ticketIds};
}

export function ticketClaimUrl(ticketId: string, eventId: string): string {
    return `${PUBLIC_ORIGIN}/claim?ticket=${encodeURIComponent(ticketId)}&event=${encodeURIComponent(eventId)}`;
}

export function walletPassUrl(ticketId: string, eventId: string): string {
    return `${PUBLIC_ORIGIN}/api/wallet-pass?ticket=${encodeURIComponent(ticketId)}&event=${encodeURIComponent(eventId)}`;
}

export function isScannedTicket(raw: unknown): boolean {
    const ticket = raw as {redeemed?: unknown; voided?: unknown} | null;
    return ticket?.redeemed === true && ticket.voided !== true;
}

export function isCheckedInWalkIn(data: {walkIn?: unknown; tickets?: unknown}): boolean {
    if (data.walkIn !== true || !Array.isArray(data.tickets)) return false;
    const live = data.tickets.filter(t => (t as {voided?: unknown} | null)?.voided !== true);
    return live.length > 0 && live.every(isScannedTicket);
}

const HOMETOWN_TICKET_RE = /^\d{12}$/;

export function isHometownTicketId(ticketId: string): boolean {
    return HOMETOWN_TICKET_RE.test(ticketId);
}

export function hometownAttendeeId(ticketId: string): string {
    return `hometown-${ticketId}`;
}

export function apiOrderAttendeeId(appId: string, orderId: string): string {
    return `api_${appId}_${orderId}`;
}

export function isApiOrder(data: {source?: unknown} | undefined): boolean {
    return data?.source === "api";
}

export function creditedEmail(data: {source?: unknown; email?: unknown} | undefined): string {
    return !isApiOrder(data) && typeof data?.email === "string" ? data.email : "";
}
