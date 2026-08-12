import { hasPermission, useAuth } from '~/components/AuthProvider';
import { GoToTop } from '~/components/GoToTop';
import { useConContent } from '~/lib/conContent';
import { useHashScroll } from '~/lib/useHashScroll';
import { Navigation } from '~/pages/con/Navigation';
import { Hero } from '~/pages/con/Hero';
import { About } from '~/pages/con/About';
import { Schedule } from '~/pages/con/Schedule';
import { Guests } from '~/pages/con/Guests';
import { Vendors } from '~/pages/con/Vendors';
import { Tickets } from '~/pages/con/Tickets';
import { Venue } from '~/pages/con/Venue';
import { Faq } from '~/pages/con/Faq';
import { Footer } from '~/pages/con/Footer';
import { Unpublished } from '~/pages/con/Unpublished';
import { useT } from '~/pages/con/i18n';

/**
 * The Sekai Beyond Con page. It carries its own navbar and footer rather than the
 * main site's: the bar sits transparent over the hero video and its links are
 * anchors into this page's sections, neither of which the shared chrome does.
 * `sbc-` prefixes keep its styles clear of the global class names in app/styles.
 */
export const ConPage = () => {
    // Makes /con#tickets work on a cold load, not just in-page clicks.
    useHashScroll();

    const t = useT();
    const {content, loading} = useConContent();
    const {profile, loading: authLoading} = useAuth();

    const canPreview = !!profile && hasPermission(profile.group, 'core-staff');
    const published = content.settings.published;

    // Both the switch and the viewer's group arrive asynchronously. Rendering the
    // page before either is known would flash an unpublished con at the public,
    // which is the one thing this switch exists to prevent.
    if (loading || authLoading) return <div className="sbc-page"/>;

    if (!published && !canPreview) return <Unpublished/>;

    return (
        <div className="sbc-page">
            {!published && (
                <div className="sbc-preview-banner" role="status">
                    {t({
                        en: 'Not published — only core staff can see this page. Publish it from Admin → Con Content.',
                        zh: '尚未发布——仅核心成员可见。可在「管理面板 → 漫展内容」中发布。',
                    })}
                </div>
            )}
            <Navigation/>
            <main>
                <Hero/>
                <About/>
                <Schedule/>
                <Guests/>
                <Vendors/>
                <Tickets/>
                <Venue/>
                <Faq/>
            </main>
            <Footer/>
            <GoToTop/>
        </div>
    );
};
