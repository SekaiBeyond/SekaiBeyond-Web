import { GoToTop } from '~/components/GoToTop';
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

/**
 * The Sekai Beyond Con page. It carries its own navbar and footer rather than the
 * main site's: the bar sits transparent over the hero video and its links are
 * anchors into this page's sections, neither of which the shared chrome does.
 * `sbc-` prefixes keep its styles clear of the global class names in app/styles.
 */
export const ConPage = () => {
    // Makes /con#tickets work on a cold load, not just in-page clicks.
    useHashScroll();

    return (
        <div className="sbc-page">
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
