import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import React from "react";
import { LINKS } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";

export const Contact = () => {
    const {isEnglish} = useLanguage();

    return (<section id="contact" className="contact-section section">
        <div className="section-header">
            <h2 className="section-title">{isEnglish ? "Follow Us" : "关注我们"}</h2>
            <p className="section-subtitle">
                {isEnglish ? "Follow us on social media for the latest updates and announcements!" : "关注我们的社交媒体，获取最新动态和公告！"}
            </p>
        </div>
        <div className="contact-inner">
            <div className="social-links-grid">
                <a className="social-card" href={LINKS.discord} target="_blank" rel="noopener noreferrer">
                    <SiDiscord className="social-icon"/>
                    <div className="social-name">Discord</div>
                </a>
                <a className="social-card" href={LINKS.instagram} target="_blank" rel="noopener noreferrer">
                    <SiInstagram className="social-icon"/>
                    <div className="social-name">Instagram</div>
                </a>
                <a className="social-card" href={LINKS.bilibili} target="_blank" rel="noopener noreferrer">
                    <SiBilibili className="social-icon"/>
                    <div className="social-name">{isEnglish ? "Bilibili" : "哔哩哔哩"}</div>
                </a>
                <a className="social-card" href={LINKS.xiaohongshu} target="_blank" rel="noopener noreferrer">
                    <SiXiaohongshu className="social-icon"/>
                    <div className="social-name">{isEnglish ? "Xiaohongshu" : "小红书"}</div>
                </a>
                <a className="social-card" href={LINKS.linkedin} target="_blank" rel="noopener noreferrer">
                    <FaLinkedin className="social-icon"/>
                    <div className="social-name">{isEnglish ? "LinkedIn" : "领英"}</div>
                </a>
            </div>
        </div>
    </section>)
}
