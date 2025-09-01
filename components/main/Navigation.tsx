import { HashLink } from "react-router-hash-link";
import React, { useEffect, useState } from "react";


export const Navigation = () => {

    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
            <div className="nav-container">
                <HashLink to="#home" className="logo">
                    <span>SEKAI BEYOND</span>
                    <span className="logo-text-cn">彼世界</span>
                </HashLink>
                <ul className={`nav-links ${mobileMenuOpen ? 'active' : ''}`}>
                    <li><HashLink to="#home" className="nav-link">Home</HashLink></li>
                    <li><HashLink to="#about" className="nav-link">About 关于</HashLink></li>
                    <li><HashLink to="#events" className="nav-link">Events 活动</HashLink></li>
                    <li><HashLink to="#convention" className="nav-link">Convention 年会</HashLink></li>
                    <li><HashLink to="#team" className="nav-link">Team 团队</HashLink></li>
                    <li><HashLink to="#contact" className="nav-link">Contact 联系</HashLink></li>
                </ul>
                <HashLink to="#contact" className="join-btn">
                    <span>Join 加入我们</span>
                    <span>✨</span>
                </HashLink>
                <button
                    className="mobile-menu-btn"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    ☰
                </button>
            </div>
        </nav>
    )
}