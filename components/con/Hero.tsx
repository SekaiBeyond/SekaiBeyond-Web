import { HashLink } from "react-router-hash-link";
import { useEffect } from "react";

export const Hero = () => {

    useEffect(() => {
        // Create sakura petals
        const sakuraContainer = document.querySelector('.sakura-petals');
        if (sakuraContainer && sakuraContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const petal = document.createElement('div');
                petal.className = 'petal';
                petal.style.width = Math.random() * 15 + 10 + 'px';
                petal.style.height = petal.style.width;
                petal.style.left = Math.random() * 100 + '%';
                petal.style.animationDuration = Math.random() * 10 + 15 + 's';
                petal.style.animationDelay = Math.random() * 10 + 's';
                sakuraContainer.appendChild(petal);
            }
        }
        return () => {
        };
    }, []);


    return (
        <section id="home" className="hero">
            <div className="hero-bg-effects">
                {['✨', '⭐', '🌟', '💫', '✨', '⭐'].map((star, i) => (
                    <div
                        key={i}
                        className="sparkle"
                        style={{
                            fontSize: Math.random() * 20 + 20 + 'px',
                            left: Math.random() * 100 + '%',
                            top: Math.random() * 100 + '%',
                            animationDelay: Math.random() * 3 + 's'
                        }}
                    >
                        {star}
                    </div>
                ))}
            </div>
            <div className="hero-content">
                <div className="con-badge">
                    <span>🌸</span>
                    <span className="con-badge-text">Pacific Northwest's Biggest Student Con</span>
                    <span>🌸</span>
                </div>
                <h1 className="hero-title">SEKAI BEYOND CON</h1>
                <h2 className="hero-title-cn">彼世界动漫游戏展</h2>
                <div className="hero-date">
                    <span>October 11, 2025</span>
                    <span>|</span>
                    <span>12:00pm</span>
                    <div className="date-divider"></div>
                    <span>6:00pm</span>
                </div>
                <p className="hero-location">📍 HUB Ballrooms • 华盛顿大学</p>
                <div className="hero-buttons">
                    <HashLink to="#tickets" className="btn btn-primary">
                        <span>Get Your Tickets Now!</span>
                        <span>🎟️</span>
                    </HashLink>
                    <HashLink to="#schedule" className="btn btn-secondary">
                        <span>View Schedule</span>
                        <span>📅</span>
                    </HashLink>
                </div>
            </div>
        </section>
    )
}