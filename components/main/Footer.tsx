import { HashLink } from "react-router-hash-link";
import React from "react";
import { LINKS } from "../Constants";

export const Footer = () => (
    <footer>
        <div className="footer-logo">SEKAI BEYOND 彼世界动漫社</div>
        <div className="footer-links">
            <HashLink to="#about" className="footer-link">About 关于</HashLink>
            <HashLink to="#events" className="footer-link">Events 活动</HashLink>
            <HashLink to="#convention" className="footer-link">Convention 漫展</HashLink>
            <HashLink to="#team" className="footer-link">Team 团队</HashLink>
            <a href={LINKS.huskylink} className="footer-link">HuskyLink</a>
        </div>
        <p className="footer-text">
            © 2025 Sekai Beyond 彼世界动漫社<br/>
            A Registered Student Organization at University of Washington<br/>
            华盛顿大学注册学生组织
        </p>
    </footer>
)