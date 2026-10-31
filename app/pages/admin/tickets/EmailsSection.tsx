import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { ShowToast } from '../utils';
import { SendSection } from './SendSection';
import { TemplateSection } from './TemplateSection';
import type { AttendeeTotals } from './types';
import { parseWalletPassSettings, readWalletPassCount, type WalletPassSettings } from './walletPass';
import { WalletPassSection } from './WalletPassSection';

interface EmailsSectionProps {
    event: UpcomingEvent;
    totals: AttendeeTotals;
    readOnly: boolean;
    showToast: ShowToast;
    onSent: () => void;
    onTemplateSavedChange: (saved: boolean) => void;
}

/**
 * Ticket emails on one page: sending them, what you come back for, above the
 * template they're sent from and the wallet pass their button makes.
 */
export function EmailsSection({event, totals, readOnly, showToast, onSent, onTemplateSavedChange}: EmailsSectionProps) {
    // Edits a send wouldn't carry, since sendTicketEmails reads the saved
    // template.
    const [templateUnsaved, setTemplateUnsaved] = useState(false);

    // The stored wallet pass settings, which the template's preview follows
    // too: the button is in it while they're on.
    const [walletSettings, setWalletSettings] = useState<WalletPassSettings | null>(null);
    const [walletPassCount, setWalletPassCount] = useState(0);
    const [walletLoadFailed, setWalletLoadFailed] = useState(false);
    useEffect(() => {
        return onSnapshot(
            doc(getFirebaseDb(), 'upcomingEvents', event.id, 'settings', 'walletPass'),
            snap => {
                setWalletSettings(parseWalletPassSettings(snap.data()));
                setWalletPassCount(readWalletPassCount(snap.data()));
            },
            err => {
                console.error('[EmailsSection] wallet pass settings', err);
                setWalletLoadFailed(true);
            },
        );
    }, [event.id]);

    return (
        <>
            <SendSection
                eventId={event.id}
                totals={totals}
                readOnly={readOnly}
                showToast={showToast}
                onSent={onSent}
                templateUnsaved={templateUnsaved}
            />
            <TemplateSection
                event={event}
                readOnly={readOnly}
                showToast={showToast}
                onUnsavedChange={setTemplateUnsaved}
                onSavedChange={onTemplateSavedChange}
                walletButton={walletSettings?.enabled ?? true}
            />
            <WalletPassSection
                event={event}
                settings={walletSettings}
                passCount={walletPassCount}
                loadFailed={walletLoadFailed}
                readOnly={readOnly}
                showToast={showToast}
            />
        </>
    );
}
