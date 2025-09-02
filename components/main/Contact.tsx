import { SiDiscord, SiInstagram, SiLinkedin, SiXiaohongshu } from "react-icons/si";
import { MdMail } from "react-icons/md";
import React from "react";
import { LINKS } from "../Constants";

export const Contact = () => (
    <section id="contact" className="contact-section section">
        <div className="section-header">
            <h2 className="section-title">Get In Touch</h2>
            <h3 className="section-title-cn">联系我们</h3>
            <p className="section-subtitle">
                Join our community! 加入我们的大家庭！
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
                    <div className="social-name">小红书</div>
                </a>
                <a className="social-card" href={LINKS.linkedin} target="_blank">
                    <SiLinkedin className="social-icon"/>
                    <div className="social-name">LinkedIn 领英</div>
                </a>
                <a className="social-card" href={LINKS.email} target="_blank">
                    <MdMail className="social-icon"/>
                    <div className="social-name">Email 邮件</div>
                </a>
            </div>
        </div>
    </section>
)
