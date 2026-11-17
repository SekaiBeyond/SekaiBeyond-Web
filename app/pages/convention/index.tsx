import { hasPermission, useAuth } from '~/components/AuthProvider';
import { GoToTop } from '~/components/GoToTop';
import { useConContent, useConListing } from '~/lib/conContent';
import { useHashScroll } from '~/lib/useHashScroll';
import { useVenues } from '~/lib/venues';
import { Navigation } from '~/pages/convention/Navigation';
import { Hero } from '~/pages/convention/Hero';
import { Tickets } from '~/pages/convention/Tickets';
import { About } from '~/pages/convention/About';
import { Schedule } from '~/pages/convention/Schedule';
import { ShareCard } from '~/pages/convention/ShareCard';
import { MaidCafe } from '~/pages/convention/MaidCafe';
import { Vendors } from '~/pages/convention/Vendors';
import { Faq } from '~/pages/convention/Faq';
import { Footer } from '~/pages/convention/Footer';
import { Unpublished } from '~/pages/convention/Unpublished';
import { useT } from '~/pages/convention/i18n';

export const ConPage = () => {
    const t = useT();
    const {content, loading: contentLoading, failed} = useConContent();
    const {loading: listingLoading} = useConListing();
    const {loading: venuesLoading} = useVenues();
    const loading = contentLoading || listingLoading || venuesLoading;
    const {profile} = useAuth();

    useHashScroll(!loading);

    const canPreview = !!profile && hasPermission(profile.group, 'staff');
    const published = content.settings.published && !failed;

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
                <MaidCafe/>
                <Vendors/>
                <Faq/>
            </main>
            <Footer/>
            <GoToTop/>
        </div>
    );
};
