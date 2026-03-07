import React from "react";
import { FOOTER_LINKS, type NavLink } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";

export const Footer = () => {
    const {isEnglish} = useLanguage();

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => link.disabled ? null : (
                    link.href.startsWith("#") ? (
                        <a key={link.id} href={link.href} className="footer-link" onClick={(e) => {
                            e.preventDefault();
                            document.querySelector(link.href)?.scrollIntoView({behavior: "smooth"});
                        }}>
                            {isEnglish ? link.labelEn : link.labelCn}
                        </a>
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