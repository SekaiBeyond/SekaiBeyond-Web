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

export function EmailsSection({event, totals, readOnly, showToast, onSent, onTemplateSavedChange}: EmailsSectionProps) {
    const [templateUnsaved, setTemplateUnsaved] = useState(false);

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
