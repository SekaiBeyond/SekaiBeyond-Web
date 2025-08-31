import React from 'react';
import { Hero } from "@/../components/Hero";
import { Stats } from "@/../components/Stats";
import { About } from "@/../components/About";
import { Events } from "@/../components/Events";
import { Convention } from "@/../components/Convention";
import { Team } from "@/../components/Team";
import { Contact } from "@/../components/Contact";
import { Footer } from "@/../components/Footer";
import { Navigation } from "@/../components/Navigation";

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