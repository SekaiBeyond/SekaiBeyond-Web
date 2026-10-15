import { hasPermission, useAuth } from '~/components/AuthProvider';
import { GoToTop } from '~/components/GoToTop';
import { useConContent, useConListing } from '~/lib/conContent';
import { useHashScroll } from '~/lib/useHashScroll';
import { useVenues } from '~/lib/venues';
import { Navigation } from '~/pages/con/Navigation';
import { Hero } from '~/pages/con/Hero';
import { Tickets } from '~/pages/con/Tickets';
import { About } from '~/pages/con/About';
import { Schedule } from '~/pages/con/Schedule';
import { ShareCard } from '~/pages/con/ShareCard';
import { Guests } from '~/pages/con/Guests';
import { MaidCafe } from '~/pages/con/MaidCafe';
import { Vendors } from '~/pages/con/Vendors';
import { Faq } from '~/pages/con/Faq';
import { Footer } from '~/pages/con/Footer';
import { Unpublished } from '~/pages/con/Unpublished';
import { useT } from '~/pages/con/i18n';

/**
 * The Sekai Beyond Con page, with its own navbar and footer: the bar sits
 * transparent over the hero and links to this page's anchors. `sbc-` keeps its
 * styles clear of app/styles.
 */
export const ConPage = () => {
    const t = useT();
    // The published mirror, or the draft for staff previewing.
    const {content, loading: contentLoading, failed} = useConContent();
    // Alongside the content, so the hero doesn't flash "TBA" for the date or venue.
    const {loading: listingLoading} = useConListing();
    const {loading: venuesLoading} = useVenues();
    const loading = contentLoading || listingLoading || venuesLoading;
    const {profile} = useAuth();

    // Waits for the content, since a cold read can outlast `useHashScroll`'s own
    // retry.
    useHashScroll(!loading);

    const canPreview = !!profile && hasPermission(profile.group, 'staff');
    // A failed read falls back to defaults nobody agreed to publish.
    const published = content.settings.published && !failed;
    // Hidden for staff previews too, so the preview is the public page.
    const hidden = content.settings.hiddenSections;

    // Rendering before the switch and the viewer's group are known could flash an
    // unpublished con.
    if (loading) return <div className="sbc-page"/>;

    if (!published && !canPreview) return <Unpublished/>;

    return (
        <div className={`sbc-page${published ? '' : ' sbc-page--preview'}`}>
            {!published && (
                <div className="sbc-preview-banner" role="status">
                    {failed
                        ? t({
                            en: 'Could not load the saved content, so most sections are empty. This page is hidden from the public.',
                            zh: '无法读取已保存的内容，大部分板块为空。此页面对公众隐藏。',
                        })
                        : t({
                            en: 'Not published — only staff can see this page. Publish it from Admin → Con Content.',
                            zh: '尚未发布——仅工作人员可见。可在「管理面板 → 漫展内容」中发布。',
                        })}
                </div>
            )}
            <Navigation/>
            <main>
                <Hero/>
                <Tickets/>
                <About/>
                <Schedule/>
                <ShareCard/>
                {!hidden.includes('guests') && <Guests/>}
                <MaidCafe/>
                {!hidden.includes('vendors') && <Vendors/>}
                <Faq/>
            </main>
            <Footer/>
            <GoToTop/>
        </div>
    );
};
