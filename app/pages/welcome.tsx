import { Hero } from "~/../components/main/Hero";
import { About } from "~/../components/main/About";
import { Convention } from "~/../components/main/Convention";
import { Team } from "~/../components/main/Team";
import { Contact } from "~/../components/main/Contact";
import { Footer } from "~/../components/main/Footer";
import { Navigation } from "~/../components/main/Navigation";
import { PastEvents } from "../../components/main/PastEvents";

export const Welcome = () => (
    <>
        {/* Navigation */}
        <Navigation/>

        {/* Hero Section */}
        <Hero/>

        {/* About Section */}
        <About/>

        {/* Events Section */}
        <PastEvents/>

        {/* Convention Section */}
        <Convention/>

        {/* Team Section */}
        <Team/>

        {/* Contact Section */}
        <Contact/>

        {/* Footer */}
        <Footer/>
    </>
);