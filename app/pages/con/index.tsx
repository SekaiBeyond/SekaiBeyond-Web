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
    const t = useT();
    // Resolves to the published mirror, or to the draft when core staff are
    // previewing; `loading` already covers waiting on the viewer's group.
    const {content, loading, failed} = useConContent();
    const {profile} = useAuth();

    // The sections a hash points at do not exist until the content lands, so the
    // scroll has to wait for it — `useHashScroll`'s own 500ms retry expires long
    // before a cold Firestore read on a slow connection.
    useHashScroll(!loading);

    const canPreview = !!profile && hasPermission(profile.group, 'core-staff');
    // A read that failed falls back to the shipped defaults, and those are not a
    // page anybody agreed to publish.
    const published = content.settings.published && !failed;

    // The switch and the viewer's group both arrive asynchronously. Rendering
    // before either is known would flash an unpublished con at the public, which is
    // the one thing this switch exists to prevent.
    if (loading) return <div className="sbc-page"/>;

    if (!published && !canPreview) return <Unpublished/>;

    return (
        <div className={`sbc-page${published ? '' : ' sbc-page--preview'}`}>
            {!published && (
                <div className="sbc-preview-banner" role="status">
                    {failed
                        ? t({
                            en: 'Could not load the saved content — showing built-in copy, hidden from the public.',
                            zh: '无法读取已保存的内容——当前显示内置文案，并对公众隐藏。',
                        })
                        : t({
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
