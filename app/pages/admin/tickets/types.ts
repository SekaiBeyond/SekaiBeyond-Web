export type TicketType = 'normal' | 'early-bird' | 'vip' | 'Comp Ticket' | 'guest';

export const TICKET_TYPES: {value: TicketType; labelEn: string; labelCn: string}[] = [
    {value: 'normal', labelEn: 'Normal', labelCn: '普通'},
    {value: 'early-bird', labelEn: 'Early Bird', labelCn: '早鸟'},
    {value: 'vip', labelEn: 'VIP', labelCn: 'VIP'},
    {value: 'Comp Ticket', labelEn: 'Comp Ticket', labelCn: '赠票'},
    {value: 'guest', labelEn: 'Guest', labelCn: '嘉宾'},
];

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
}

export interface EmailTemplate {
    subject: string;
    bodyHtml: string;
    bodyCnHtml: string;
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
}

export type TicketsSection = 'scan' | 'attendees' | 'stats' | 'import' | 'template' | 'send';
