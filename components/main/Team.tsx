import React from "react";
import { OFFICERS } from "../Constants"
import { useLanguage } from "../LanguageContextProvider";

export const Team = () => {
    const {isEnglish} = useLanguage();

    return (
        <section id="team" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Our Team" : "我们的团队"}</h2>
                <p className="section-subtitle">{isEnglish ? "Meet the passionate people behind Sekai Beyond" : "认识彼世界背后的热情团队"}</p>
            </div>
            <div className="team-grid">
                {OFFICERS.map((officer, index) => (
                    <div key={index} className="team-card">
                        <img className="team-avatar" src={officer.src} alt={officer.name}/>
                        <h3 className="team-name">{!isEnglish && officer.nameCn ? officer.nameCn : officer.name}</h3>
                        <p className="team-role">{isEnglish ? officer.role : officer.roleCn}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}