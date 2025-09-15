import { HashLink } from "react-router-hash-link";
import React, { useEffect, useState } from "react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { useLanguage } from "../LanguageContextProvider";


export const Navigation = () => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const {isEnglish} = useLanguage();

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
                    <li><HashLink to="#home" className="nav-link">
                        {isEnglish ? 'Home' : '首页'}
                    </HashLink></li>
                    <li><HashLink to="#about" className="nav-link">
                        {isEnglish ? 'About Us' : '关于我们'}
                    </HashLink></li>
                    <li><HashLink to="#events" className="nav-link">
                        {isEnglish ? 'Past Events' : '往期活动'}
                    </HashLink></li>
                    <li><HashLink to="#convention" className="nav-link">
                        {isEnglish ? 'Convention' : '漫展'}
                    </HashLink></li>
                    <li><HashLink to="#team" className="nav-link">
                        {isEnglish ? 'Team' : '幕后团队'}
                    </HashLink></li>
                    <li><HashLink to="#contact" className="nav-link">
                        {isEnglish ? 'Follow Us' : '关注我们'}
                    </HashLink></li>
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <HashLink to="#contact" className="join-btn common-btn">
                        <span>{isEnglish ? 'Join Us 0 v 0' : '加入我们 0 v 0'}</span>
                    </HashLink>
                </div>
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