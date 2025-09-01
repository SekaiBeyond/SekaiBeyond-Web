import React from "react";
import { OFFICERS } from "./Constants"

export const Team = () => (
    <section id="team" className="section">
        <div className="section-header">
            <h2 className="section-title">Our Team</h2>
            <h3 className="section-title-cn">我们的团队</h3>
            <p className="section-subtitle">
                Meet the passionate people behind Sekai Beyond<br/>
                认识世界之外背后的热情团队
            </p>
        </div>
        <div className="team-grid">
            {OFFICERS.map((officer, index) => (
                <div key={index} className="team-card">
                    <div className="team-avatar">{officer.emoji}</div>
                    <h3 className="team-name">{officer.name}</h3>
                    <p className="team-role">{officer.role}</p>
                    <p className="team-role-cn">{officer.roleCn}</p>
                </div>
            ))}
        </div>
    </section>
)