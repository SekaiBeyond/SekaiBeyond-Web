export type TicketType =
    | 'normal'
    | 'early-bird'
    | 'student'
    | 'early-bird-student'
    | 'vip'
    | 'Comp Ticket'
    | 'guest'
    | 'vendor';

export const TICKET_TYPES: {value: TicketType; labelEn: string; labelCn: string}[] = [
    {value: 'normal', labelEn: 'Normal', labelCn: '普通'},
    {value: 'early-bird', labelEn: 'Early Bird', labelCn: '早鸟'},
    {value: 'student', labelEn: 'Student', labelCn: '学生'},
    {value: 'early-bird-student', labelEn: 'Early Bird Student', labelCn: '早鸟学生'},
    {value: 'vip', labelEn: 'VIP', labelCn: 'VIP'},
    {value: 'Comp Ticket', labelEn: 'Comp Ticket', labelCn: '赠票'},
    {value: 'guest', labelEn: 'Guest', labelCn: '嘉宾'},
    {value: 'vendor', labelEn: 'Vendor', labelCn: '商摊'},
];

export const ticketTypeLabel = (type: TicketType | string, isEnglish: boolean): string => {
    const tt = TICKET_TYPES.find(t => t.value === type);
    if (!tt) return String(type);
    return isEnglish ? tt.labelEn : tt.labelCn;
};

/**
 * Who a nameless, emailless attendee is: a HomeTown ticket by its number. Kept
 * here, not in helpers, so the claim page can use it without the admin's
 * dependencies.
 */
export const anonymousAttendeeName = (a: Pick<AttendeeData, 'hometown' | 'ticketIds'>, isEnglish: boolean): string =>
    a.hometown
        ? `HomeTown #${a.ticketIds[0] ?? ''}`
        : (isEnglish ? 'Walk-in guest' : '现场来宾');

export interface TicketData {
    ticketId: string;
    type: TicketType;
    createdAt: Date | null;
    redeemed: boolean;
    redeemedAt: Date | null;
    redeemedByName: string;
    voided: boolean;
    /** A staff comment, empty for none. */
    notes: string;
}

export interface AttendeeData {
    id: string;
    email: string;
    name: string;
    ticketCount: number;
    emailSent: boolean;
    emailScheduled: boolean;
    emailSentAt: Date | null;
    createdAt: Date;
    tickets: TicketData[];
    ticketIds: string[];
    walkIn: boolean;
    hometown: boolean;
    /** A HomeTown ticket let in at the door while missing from the imported list. */
    unlisted: boolean;
    /** A listed HomeTown ticket left out of a later export. */
    missingFromHometown: boolean;
    hometownSeenAt: Date | null;
    hometownOrderId: string;
    /** Sold in another app and issued through the ticket API: never re-issued, nor emailed from here unless it asked. */
    apiOrder: boolean;
    /** An API order that asked for its tickets to be emailed from here. */
    apiSendEmail: boolean;
    /** The seller's own order number. */
    apiOrderId: string;
    /** The API key that placed it, named as it was then. */
    apiKeyName: string;
}

export interface EmailTemplate {
    subject: string;
    bodyHtml: string;
    updatedAt: Date | null;
}

export interface ParsedRow {
    email: string;
    name: string;
    ticketCount: number;
    type: TicketType;
    timestamp?: string;
    existingName?: string;
    existingTicketCount?: number;
    existingType?: TicketType;
    action?: 'add' | 'skip' | 'override';
}

export interface ParseError {
    row: number;
    message: string;
}

export interface AttendeeTotals {
    attendees: number;
    tickets: number;
    used: number;
    voided: number;
    unsent: number;
    sendable: number;
    unsentSendable: number;
    walkIns: number;
    hometown: number;
    unlisted: number;
    missingFromHometown: number;
}

export type StatusFilter = 'all' | 'redeemed' | 'unredeemed' | 'voided' | 'unlisted' | 'missing';

export type TicketsSection = 'scan' | 'attendees' | 'stats' | 'import' | 'emails' | 'settings';
