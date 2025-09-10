import { CON_SCHEDULES, type ConSchedule } from "../Constants";

export const Schedule = () => (
    <section id="schedule" className="schedule-section">
        <div className="section-header">
            <h2 className="section-title">Event Schedule</h2>
            <h3 className="section-title-cn">活动日程</h3>
        </div>
        <div className="schedule-content">
            {CON_SCHEDULES.map((item: ConSchedule, index: number) => (
                <div key={index} className="schedule-item">
                    <div className="schedule-time">{item.time}</div>
                    <div className="schedule-details">
                        <h4>{item.title}</h4>
                        <p className="schedule-details-cn">{item.titleCn}</p>
                        <p>{item.description}</p>
                        <p className="schedule-description-cn">{item.descriptionCn}</p>
                    </div>
                </div>
            ))}
        </div>
    </section>
)