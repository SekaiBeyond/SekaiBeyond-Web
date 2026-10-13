import { useLanguage } from '~/components/LanguageContextProvider';
import { useConDraft } from '~/lib/conContent';
import type { ShowToast } from './utils';
import { SectionNav } from './SectionNav';
import { conSectionId, SECTION_LABELS, SECTION_ORDER, type SectionProps, } from './conContentShared';
import { EventSection, HeroVideoSection, RoomsSection, SettingsSection, } from './ConEventSections';
import { GuestsSection, ScheduleSection } from './ConScheduleGuestSections';
import { VendorsSection } from './ConVendorsSection';
import { InPersonSalesSection, TicketFeeSection, TicketsSection, } from './ConTicketsSections';
import { FaqSection } from './ConFaqSection';

/**
 * Editor for the public /con page's copy. Everything here is saved to the
 * staff-only `conContent/draft`, mirrored to the public `conContent/main` while
 * the con is published, and read back through `app/lib/conContent.ts`.
 *
 * Each section owns its own Save button and writes only its own field, so two
 * people editing different parts of the page cannot clobber each other. The
 * parts of the con page that are not editable here — the con's name, the About
 * section, the nav links, the room colours — stay in code.
 */

interface ConContentTabProps {
    showToast: ShowToast;
    readOnly?: boolean;
}

export const ConContentTab = ({showToast, readOnly = false}: ConContentTabProps) => {
    const {isEnglish} = useLanguage();
    const {content, loading, failed} = useConDraft();

    if (loading) {
        return (
            <div className="admin-section">
                <div className="policy-spinner-wrap">
                    <div className="spinner"/>
                </div>
            </div>
        );
    }

    // Editing here would mean saving the blank defaults over whatever is
    // actually stored, so the form stays closed until a read succeeds.
    if (failed) {
        return (
            <div className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Could not load con content' : '无法加载漫展内容'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'The saved content could not be read. Reload the page before editing — saving now would replace what is stored.'
                        : '无法读取已保存的内容。请重新加载页面后再编辑——此时保存会覆盖已存储的内容。'}
                </p>
            </div>
        );
    }

    const sectionProps: SectionProps = {content, loading, showToast, readOnly};

    return (
        <>
            <div className="admin-section">
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'While the page is published, edits here go live on /con as soon as they are saved. Each section saves on its own, so you can leave the rest untouched. A section never saved shows empty on /con.'
                        : '页面发布期间，此处的修改保存后立即在 /con 页面生效。每个板块单独保存，不会影响其他板块。从未保存过的板块在 /con 页面上显示为空。'}
                </p>
            </div>

            <SettingsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <EventSection {...sectionProps}/>
            <div className="admin-divider"/>
            <HeroVideoSection {...sectionProps}/>
            <div className="admin-divider"/>
            <RoomsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <ScheduleSection {...sectionProps}/>
            <div className="admin-divider"/>
            <GuestsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <VendorsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <TicketsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <TicketFeeSection {...sectionProps}/>
            <div className="admin-divider"/>
            <InPersonSalesSection {...sectionProps}/>
            <div className="admin-divider"/>
            <FaqSection {...sectionProps}/>

            <SectionNav
                sections={SECTION_ORDER.map(section => ({
                    id: conSectionId(section),
                    label: isEnglish ? SECTION_LABELS[section].en : SECTION_LABELS[section].zh,
                }))}
            />
        </>
    );
};
