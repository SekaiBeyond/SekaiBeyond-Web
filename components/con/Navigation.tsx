import { useEffect, useState } from "react";
import { CONVENTION_DATE } from "../Constants";
import { HashLink } from "react-router-hash-link";

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
            <HashLink to="#home" className="logo">
                <span>SEKAI CON</span>
                <span className="logo-year">{CONVENTION_DATE.getFullYear()}</span>
            </HashLink>
            <ul className={`nav-links ${mobileMenuOpen ? 'active' : ''}`}>
                <li><HashLink to="#home" className="nav-link">Home 首页</HashLink></li>
                <li><HashLink to="#guests" className="nav-link">Guests 嘉宾</HashLink></li>
                <li><HashLink to="#schedule" className="nav-link">Schedule 日程</HashLink></li>
                <li><HashLink to="#activities" className="nav-link">Activities 活动</HashLink></li>
                <li><HashLink to="#tickets" className="nav-link">Tickets 门票</HashLink></li>
                <li><HashLink to="#venue" className="nav-link">Venue 场地</HashLink></li>
            </ul>
            <HashLink to="#tickets" className="ticket-btn common-btn">
                <span>Get Tickets</span>
                <span>🎫</span>
            </HashLink>
            <button
                className="mobile-menu-btn"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
                ☰
            </button>
        </div>
    </nav>)
}