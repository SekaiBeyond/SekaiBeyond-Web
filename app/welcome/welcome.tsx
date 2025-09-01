import React from 'react';
import { Hero } from "@/../components/main/Hero";
import { Stats } from "@/../components/main/Stats";
import { About } from "@/../components/main/About";
import { Events } from "@/../components/main/Events";
import { Convention } from "@/../components/main/Convention";
import { Team } from "@/../components/main/Team";
import { Contact } from "@/../components/main/Contact";
import { Footer } from "@/../components/main/Footer";
import { Navigation } from "@/../components/main/Navigation";

export const Welcome = () => {
    return (
        <div>
            {/* Navigation */}
            <Navigation/>

            {/* Hero Section */}
            <Hero/>

            {/* Stats Section */}
            <Stats/>

            {/* About Section */}
            <About/>

            {/* Events Section */}
            <Events/>

            {/* Convention Section */}
            <Convention/>

            {/* Team Section */}
            <Team/>

            {/* Contact Section */}
            <Contact/>

            {/* Footer */}
            <Footer/>
        </div>
    );
};