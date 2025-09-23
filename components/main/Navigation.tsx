import { HashLink } from "react-router-hash-link";
import React, { useEffect, useState } from "react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { useLanguage } from "../LanguageContextProvider";
import { NAVIGATION_LINKS, type NavigationLink } from "../Constants";


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
                    {NAVIGATION_LINKS.map((link: NavigationLink) => (
                        <li key={link.id}>
                            <HashLink to={link.href} className="nav-link">
                                {isEnglish ? link.labelEn : link.labelCn}
                            </HashLink>
                        </li>
                    ))}
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <HashLink to="#contact" className="join-btn common-btn">
                        <span>{isEnglish ? 'Join Us' : '加入我们'}</span>
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