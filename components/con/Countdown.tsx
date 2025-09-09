import { useEffect, useState } from "react";
import { CONVENTION_DATE } from "../Constants"

export const Countdown = () => {

    const [countdown, setCountdown] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    });

    useEffect(() => {

        // Countdown timer
        const eventDate = CONVENTION_DATE.getTime();
        const timer = setInterval(() => {
            const now = new Date().getTime();
            const distance = eventDate - now;

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            setCountdown({days, hours, minutes, seconds});

            if (distance < 0) {
                clearInterval(timer);
                setCountdown({days: 0, hours: 0, minutes: 0, seconds: 0});
            }
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, []);

    return (
        <section className="countdown-section">
            <div className="countdown">
                <div className="countdown-item">
                    <div className="countdown-number">{countdown.days}</div>
                    <div className="countdown-label">Days</div>
                    <div className="countdown-label-cn">天</div>
                </div>
                <div className="countdown-item">
                    <div className="countdown-number">{countdown.hours}</div>
                    <div className="countdown-label">Hours</div>
                    <div className="countdown-label-cn">小时</div>
                </div>
                <div className="countdown-item">
                    <div className="countdown-number">{countdown.minutes}</div>
                    <div className="countdown-label">Minutes</div>
                    <div className="countdown-label-cn">分钟</div>
                </div>
                <div className="countdown-item">
                    <div className="countdown-number">{countdown.seconds}</div>
                    <div className="countdown-label">Seconds</div>
                    <div className="countdown-label-cn">秒</div>
                </div>
            </div>
        </section>
    )
}