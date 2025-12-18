import { HashLink } from "react-router-hash-link";
import React from "react";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { useLanguage } from "~/components/LanguageContextProvider";
import { NAVIGATION_LINKS, type NavLink } from "~/constants";


export const Navigation = () => {
    const {isEnglish} = useLanguage();

    return (
        <nav className="navbar">
            <div className="nav-container">
                <HashLink to="#home" className="logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</HashLink>
                <ul className="nav-links">
                    {NAVIGATION_LINKS.map((link: NavLink) => link.disabled ? null : (
                        <li key={link.id}>
                            <HashLink to={link.href} className="nav-link">
                                {isEnglish ? link.labelEn : link.labelCn}
                            </HashLink>
                        </li>
                    ))}
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                </div>
            </div>
        </nav>
    )
}