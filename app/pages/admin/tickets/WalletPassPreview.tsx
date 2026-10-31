import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { SITE_TIME_ZONE } from '~/lib/siteTime';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { resolveVenueById, useVenues } from '~/lib/venues';
import { TICKET_TYPES, type TicketType, ticketTypeLabel } from './types';
import { WALLET_COLOR_STYLES, WALLET_PASS_TOP_TEXT, type WalletPassSettings, walletTicketStyle, } from './walletPass';

interface WalletPassPreviewProps {
    event: UpcomingEvent;
    settings: WalletPassSettings;
    contactEmail: string;
}

const SAMPLE_TICKET_ID = 'ticket-uuid-1';

/**
 * A pass as Apple Wallet lays it out, front and back, for a sample ticket.
 * Mirrors passBody on the server.
 */
export function WalletPassPreview({event, settings, contactEmail}: WalletPassPreviewProps) {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [type, setType] = useState<TicketType>('normal');

    const ticket = walletTicketStyle(type);
    const colors = WALLET_COLOR_STYLES[settings.color === 'auto' ? ticket.color : settings.color];
    const title = event.title.trim() || event.titleCn.trim() || 'Event';
    const venue = resolveVenueById(event.venueId, venues);
    const location = event.location.trim() || venue?.nameEn.trim() || event.locationCn.trim() || venue?.nameCn.trim();
    const date = event.startAt.toLocaleString('en-US', {
        timeZone: SITE_TIME_ZONE,
        year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZoneName: 'shortGeneric',
    });
    const claimUrl = `${window.location.origin}/claim?ticket=${SAMPLE_TICKET_ID}&event=${encodeURIComponent(event.id)}`;
    const backFields = [
        {label: 'Ticket ID', value: SAMPLE_TICKET_ID},
        {label: 'Ticket Type', value: ticket.label},
        ...(contactEmail ? [{label: 'Questions', value: contactEmail}] : []),
        ...settings.notes.filter(n => n.value.trim()),
    ];

    const field = (label: string, value: string, className = '') => (
        <div className={`admin-wallet-preview-field ${className}`}>
            <span className="admin-wallet-preview-label" style={{color: colors.label}}>{label}</span>
            <span className="admin-wallet-preview-value">{value}</span>
        </div>
    );

    return (
        <div className="admin-wallet-preview">
            <div className="admin-wallet-preview-sides">
                <figure className="admin-wallet-preview-side">
                    <div className="admin-wallet-preview-card" style={{background: colors.bg, color: colors.fg}}>
                        <div className="admin-wallet-preview-top">
                            <span className="admin-wallet-preview-logo">{WALLET_PASS_TOP_TEXT}</span>
                            {field('Ticket', ticket.shortLabel, 'admin-wallet-preview-field--end')}
                        </div>
                        {field('Event', title, 'admin-wallet-preview-field--primary')}
                        <div className="admin-wallet-preview-row">
                            {field('Date', date)}
                            {location && field('Location', location)}
                        </div>
                        <div className="admin-wallet-preview-barcode">
                            <div className="admin-wallet-preview-qr">
                                <QRCodeSVG value={claimUrl} size={112} level="M"/>
                            </div>
                        </div>
                    </div>
                    <figcaption>{isEnglish ? 'Front' : '正面'}</figcaption>
                </figure>
                <figure className="admin-wallet-preview-side">
                    <div className="admin-wallet-preview-back">
                        {backFields.map((f, i) => (
                            <div key={i} className="admin-wallet-preview-back-row">
                                {f.label && <span className="admin-wallet-preview-back-label">{f.label}</span>}
                                <span className="admin-wallet-preview-back-value">{f.value}</span>
                            </div>
                        ))}
                    </div>
                    <figcaption>{isEnglish ? 'Back' : '背面'}</figcaption>
                </figure>
            </div>
            <label className="admin-wallet-preview-type">
                <span>{isEnglish ? 'Preview as' : '预览门票类型'}</span>
                <select className="admin-input admin-select admin-input--sm" value={type}
                        onChange={e => setType(e.target.value as TicketType)}>
                    {TICKET_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{ticketTypeLabel(t.value, isEnglish)}</option>
                    ))}
                </select>
            </label>
            <p className="admin-time-hint">
                {isEnglish
                    ? 'Close to how Apple Wallet shows it. Google Wallet shows the same details in its own layout, with the back under Details.'
                    : '与 Apple 钱包中的样子相近。Google 钱包以自己的布局显示相同内容，背面信息位于"详情"中。'}
            </p>
        </div>
    );
}
