import { Hero } from "~/../components/con/Hero";
import { Navigation } from "~/../components/con/Navigation";
import { Countdown } from "~/../components/con/Countdown";
import { Guests } from "~/../components/con/Guests";
import { Schedule } from "~/../components/con/Schedule";
import { Activities } from "~/../components/con/Activities";
import { Tickets } from "~/../components/con/Tickets";
import { Venue } from "~/../components/con/Venue";
import { Footer } from "~/../components/con/Footer";

export const Con = () => (
    <>
        <div className="sakura-petals"/>

        {/* Navigation */}
        <Navigation/>

        {/* Hero Section */}
        <Hero/>

        {/* Countdown Section */}
        <Countdown/>

        {/* Special Guests */}
        <Guests/>

        {/* Schedule */}
        <Schedule/>

        {/* Activities */}
        <Activities/>

        {/* Tickets */}
        <Tickets/>

        {/* Venue */}
        <Venue/>

        {/* Footer */}
        <Footer/>
    </>
)