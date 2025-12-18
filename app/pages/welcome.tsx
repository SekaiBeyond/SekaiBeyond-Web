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

export const Welcome = () => (
    <>
        {/* Navigation */}
        <Navigation/>

        {/* Hero Section */}
        <Hero/>

        {/* About Section */}
        <About/>

        {/* Video Section */}
        <Video/>

        {/* Sekai Beyond Con Section */}
        <SekaiBeyondCon/>

        {/* Past Events Section */}
        <PastEvents/>

        {/* Upcoming Event Section */}
        <UpcomingEvent/>

        {/* Team Section */}
        <Team/>

        {/* Contact Section */}
        <Contact/>

        {/* Footer */}
        <Footer/>
    </>
);