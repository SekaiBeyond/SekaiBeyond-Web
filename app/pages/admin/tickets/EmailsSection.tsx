import { useState } from 'react';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { ShowToast } from '../utils';
import { SendSection } from './SendSection';
import { TemplateSection } from './TemplateSection';
import type { AttendeeTotals } from './types';

interface EmailsSectionProps {
    event: UpcomingEvent;
    totals: AttendeeTotals;
    readOnly: boolean;
    showToast: ShowToast;
    onSent: () => void;
}

/**
 * Ticket emails on one page: sending them, what you come back for, above the
 * template they're sent from.
 */
export function EmailsSection({event, totals, readOnly, showToast, onSent}: EmailsSectionProps) {
    // Edits a send wouldn't carry, since sendTicketEmails reads the saved
    // template.
    const [templateUnsaved, setTemplateUnsaved] = useState(false);

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
            />
        </>
    );
}
