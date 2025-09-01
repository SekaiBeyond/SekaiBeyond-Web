import { useEffect, useState } from "react";

export const Navigation = () => {

    const [scrolled, setScrolled] = useState<boolean>(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (<nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-container">
            <a href="#home" className="logo">
                <span>SEKAI CON</span>
                <span className="logo-year">2025</span>
            </a>
            <ul className={`nav-links ${mobileMenuOpen ? 'active' : ''}`}>
                <li><a href="#home" className="nav-link">Home 首页</a></li>
                <li><a href="#guests" className="nav-link">Guests 嘉宾</a></li>
                <li><a href="#schedule" className="nav-link">Schedule 日程</a></li>
                <li><a href="#activities" className="nav-link">Activities 活动</a></li>
                <li><a href="#tickets" className="nav-link">Tickets 门票</a></li>
                <li><a href="#venue" className="nav-link">Venue 场地</a></li>
            </ul>
            <a href="#tickets" className="join-btn">
                <span>Get Tickets</span>
                <span>🎫</span>
            </a>
            <button
                className="mobile-menu-btn"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
                ☰
            </button>
        </div>
    </nav>)
}