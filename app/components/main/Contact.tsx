import type { MouseEvent } from "react";
import { Link } from "react-router";
import { SiDiscord } from "react-icons/si";
import { FaEnvelope, FaShieldAlt, FaUsers } from "react-icons/fa";
import { useLanguage } from "~/components/LanguageContextProvider";
import { useSiteConfig } from "~/lib/siteConfig";

export const Contact = () => {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();

    const scrollToTeam = (e: MouseEvent) => {
        e.preventDefault();
        document.getElementById("team")?.scrollIntoView({behavior: "smooth"});
    };

    return (
        <section id="contact" className="contact-section section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Contact Us" : "联系我们"}</h2>
                <p className="section-subtitle">
                    {isEnglish
                        ? "Have a question, collaboration idea, or need support? Here's how to reach us."
                        : "有任何问题、合作意向或需要帮助？可以通过以下方式联系我们。"}
                </p>
            </div>
            <div className="contact-cards">
                <div className="contact-card">
                    <h3 className="contact-card-title">
                        {isEnglish ? "General Inquiries" : "日常咨询与合作"}
                    </h3>
                    <p className="contact-card-body">
                        {isEnglish
                            ? "Questions about our events, collaborations, or joining the club? Reach out by email, message us on Discord, or talk to any of our officers."
                            : "想了解社团活动、洽谈合作或加入我们？欢迎发送邮件、在 Discord 联系我们，或直接找任何一位社团干部。"}
                    </p>
                    <div className="contact-card-actions">
                        {config.contactEmail && (
                            <a className="contact-action" href={`mailto:${config.contactEmail}`}>
                                <FaEnvelope aria-hidden="true"/>
                                {isEnglish ? "Email Us" : "发送邮件"}
                            </a>
                        )}
                        {config.socialLinks.discord && (
                            <a
                                className="contact-action"
                                href={config.socialLinks.discord}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <SiDiscord aria-hidden="true"/>
                                Discord
                            </a>
                        )}
                        {config.teamMembers.length > 0 && (
                            <a className="contact-action" href="#team" onClick={scrollToTeam}>
                                <FaUsers aria-hidden="true"/>
                                {isEnglish ? "Our Team" : "社团干部"}
                            </a>
                        )}
                    </div>
                </div>

                <div className="contact-card">
                    <h3 className="contact-card-title">
                        {isEnglish ? "Harassment & Safety Support" : "反骚扰与安全求助"}
                    </h3>
                    <p className="contact-card-body">
                        {isEnglish
                            ? "If you've experienced or witnessed sexual assault, harassment, or a safety concern, find confidential University of Washington resources and how to reach a club officer."
                            : "如果你亲身经历或目睹了性侵害、性骚扰或安全问题，可以在这里查看华盛顿大学（UW）的保密求助资源，以及联系社团干部的方式。"}
                    </p>
                    <div className="contact-card-actions">
                        <Link to="/support" className="contact-action contact-action--primary">
                            <FaShieldAlt aria-hidden="true"/>
                            {isEnglish ? "Harassment & Safety Support →" : "查看反骚扰与安全求助 →"}
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
};
