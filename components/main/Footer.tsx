import { HashLink } from "react-router-hash-link";
import React from "react";
import { FOOTER_LINKS, type NavLink } from "../Constants";
import { useLanguage } from "../LanguageContextProvider";

export const Footer = () => {
    const {isEnglish} = useLanguage();

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => (
                    link.href.startsWith("#") ? (
                        <HashLink key={link.id} to={link.href} className="footer-link">
                            {isEnglish ? link.labelEn : link.labelCn}
                        </HashLink>
                    ) : (
                        <a key={link.id} href={link.href} className="footer-link" target="_blank">
                            {isEnglish ? link.labelEn : link.labelCn}
                        </a>
                    )
                ))}
            </div>
            <p className="footer-text">
                © 2025 {isEnglish ? "Sekai Beyond" : "彼世界动漫社"}<br/>
                {isEnglish ? "A Registered Student Organization at University of Washington" : "华盛顿大学注册学生组织"}
            </p>
        </footer>
    )
}