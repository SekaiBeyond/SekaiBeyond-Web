export interface TicketData {
    ticketId: string;
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
    existingName?: string;
    existingTicketCount?: number;
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
}

export type TicketsSection = 'scan' | 'attendees' | 'import' | 'template' | 'send';
