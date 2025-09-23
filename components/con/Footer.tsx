import { RSO_EMAIL } from "../Constants";

export const Footer = () => (
    <footer>
        <div className="footer-content">
            <div className="footer-logo">SEKAI BEYOND CON 2025</div>
            <div className="social-links">
                <a href="#" className="social-link">📷</a>
                <a href="#" className="social-link">🐦</a>
                <a href="#" className="social-link">📺</a>
                <a href="#" className="social-link">💬</a>
                <a href="#" className="social-link">📱</a>
            </div>
            <p className="footer-info">
                Organized by Sekai Beyond, a RSO @ University of Washington<br/>
                由华盛顿大学的彼世界动漫社主办<br/>
                <br/>
                Contact: {RSO_EMAIL} | 联系: {RSO_EMAIL}
            </p>
            <div className="footer-links">
                <a href="#" className="footer-link">FAQ 常见问题</a>
                <a href="#" className="footer-link">Rules 规则</a>
                <a href="#" className="footer-link">Vendors 商家</a>
                <a href="#" className="footer-link">Volunteers 志愿者</a>
                <a href="#" className="footer-link">Sponsors 赞助商</a>
            </div>
        </div>
    </footer>
)