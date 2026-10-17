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

export interface TicketData {
    ticketId: string;
    type: TicketType;
    createdAt: Date | null;
    redeemed: boolean;
    redeemedAt: Date | null;
    redeemedBy: string;
    redeemedByName: string;
    checkedIn: boolean;
    checkedInAt: Date | null;
    voided: boolean;
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
    updatedAt: Date;
    tickets: TicketData[];
    ticketIds: string[];
    /** Added at the door, with an email only if they gave one. */
    walkIn: boolean;
    /** One ticket sold through HomeTown, kept by its number. */
    hometown: boolean;
    /** A HomeTown ticket let in at the door while missing from the imported list. */
    unlisted: boolean;
    /** A listed HomeTown ticket left out of a later export: refunded or transferred, most likely. */
    missingFromHometown: boolean;
    /** When it last appeared in an imported export. */
    hometownSeenAt: Date | null;
    hometownOrderId: string;
}

export interface EmailTemplate {
    subject: string;
    bodyHtml: string;
    updatedAt: Date | null;
    updatedBy: string;
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

/**
 * What the attendee list's status filter shows: tickets by their state, or
 * HomeTown tickets the list hasn't confirmed.
 */
export type StatusFilter = 'all' | 'redeemed' | 'unredeemed' | 'voided' | 'unlisted' | 'missing';

export type TicketsSection = 'scan' | 'attendees' | 'stats' | 'import' | 'template' | 'send';
