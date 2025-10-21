import { HashLink } from "react-router-hash-link";
import React from "react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { useLanguage } from "../LanguageContextProvider";
import { NAVIGATION_LINKS, type NavLink } from "../Constants";


export const Navigation = () => {
    const {isEnglish} = useLanguage();

    return (
        <nav className="navbar">
            <div className="nav-container">
                <HashLink to="#home" className="logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</HashLink>
                <ul className="nav-links">
                    {NAVIGATION_LINKS.map((link: NavLink) => (
                        <li key={link.id}>
                            <HashLink to={link.href} className="nav-link">
                                {isEnglish ? link.labelEn : link.labelCn}
                            </HashLink>
                        </li>
                    ))}
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <HashLink to="#contact" className="join-btn common-btn desktop-only">
                        <span>{isEnglish ? 'Join Us' : '加入我们'}</span>
                    </HashLink>
                </div>
            </div>
        </nav>
    )
}