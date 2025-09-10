import { CON_GUESTS } from "../Constants";

export const Guests = () => (
    <section id="guests" className="guests-section">
        <div className="section-header">
            <h2 className="section-title">Special Guests</h2>
            <h3 className="section-title-cn">特邀嘉宾</h3>
            <p className="section-subtitle">
                Meet industry professionals and rising stars!<br/>
                与业界专业人士和新星见面！
            </p>
        </div>
        <div className="guests-grid">
            {CON_GUESTS.map((guest, index) => (
                <div key={index} className="guest-card">
                    <img className="guest-avatar" src={guest.icon} alt={guest.name}/>
                    <h3 className="guest-name">{guest.name}</h3>
                    <p className="guest-title">{guest.title}</p>
                    <p className="guest-bio">{guest.bio}</p>
                </div>
            ))}
        </div>
    </section>
)