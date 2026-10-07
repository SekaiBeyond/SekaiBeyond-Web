import { Hero } from "~/components/main/Hero";
import { About } from "~/components/main/About";
import { Video } from "~/components/main/Video";
import { Team } from "~/components/main/Team";
import { Contact } from "~/components/main/Contact";
import { Footer } from "~/components/main/Footer";
import { Navigation } from "~/components/main/Navigation";
import { PastEvents } from "~/components/main/PastEvents";
import { UpcomingEvent } from "~/components/main/UpcomingEvent";
import { SekaiBeyondCon } from "~/components/main/SekaiBeyondCon";
import { GoToTop } from "~/components/GoToTop";
import { useHashScroll } from "~/lib/useHashScroll";

export const Welcome = () => {
    useHashScroll();

    return (
        <>
            <Navigation/>
            <Hero/>
            <About/>
            <Video/>
            <SekaiBeyondCon/>
            <PastEvents/>
            <UpcomingEvent/>
            <Team/>
            <Contact/>
            <Footer/>
            <GoToTop/>
        </>
    );
};