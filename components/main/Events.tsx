import React from "react";
import { ALL_EVENTS } from "../Constants";

export const Events = () => (
    <section id="events" className="section">
        <div className="section-header">
            <h2 className="section-title">Regular Events</h2>
            <h3 className="section-title-cn">定期活动</h3>
            <p className="section-subtitle">
                Something exciting every week! 每周都有精彩活动！
            </p>
        </div>
        <div className="events-grid">
            {ALL_EVENTS.map((event, index) => (
                <div key={index} className="event-card">
                    <span className="event-type">{event.type}</span>
                    <h3 className="event-title">{event.title}</h3>
                    <p className="event-title-cn">{event.titleCn}</p>
                    <div className="event-date">
                        <span>{event.icon}</span>
                        <span>{event.date}</span>
                    </div>
                    <p className="event-description">{event.description}</p>
                </div>
            ))}
        </div>
    </section>
)