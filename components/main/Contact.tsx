import { SiDiscord, SiInstagram, SiLinkedin, SiXiaohongshu } from "react-icons/si";
import { MdMail } from "react-icons/md";
import React from "react";
import { LINKS } from "../Constants";
import { useLanguage } from "../LanguageContextProvider";

export const Contact = () => {
    const {isEnglish} = useLanguage();

    return (<section id="contact" className="contact-section section">
        <div className="section-header">
            <h2 className="section-title">{isEnglish ? "Follow Us" : "关注我们"}</h2>
            <p className="section-subtitle">
                {isEnglish ? "Follow us on social media for the latest updates and announcements!" : "关注我们的社交媒体，获取最新动态和公告！"}
            </p>
        </div>
        <div style={{maxWidth: '800px', margin: '0 auto'}}>
            <div className="social-links-grid">
                <a className="social-card" href={LINKS.discord} target="_blank">
                    <SiDiscord className="social-icon"/>
                    <div className="social-name">Discord</div>
                </a>
                <a className="social-card" href={LINKS.instagram} target="_blank">
                    <SiInstagram className="social-icon"/>
                    <div className="social-name">Instagram</div>
                </a>
                <a className="social-card" href={LINKS.xiaohongshu} target="_blank">
                    <SiXiaohongshu className="social-icon"/>
                    <div className="social-name">{isEnglish ? "Xiaohongshu" : "小红书"}</div>
                </a>
                <a className="social-card" href={LINKS.linkedin} target="_blank">
                    <SiLinkedin className="social-icon"/>
                    <div className="social-name">{isEnglish ? "LinkedIn" : "领英"}</div>
                </a>
                <a className="social-card" href={LINKS.email} target="_blank">
                    <MdMail className="social-icon"/>
                    <div className="social-name">{isEnglish ? "Email" : "邮件"}</div>
                </a>
            </div>
        </div>
    </section>)
}
