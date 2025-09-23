import { LINKS, TICKET_TYPES } from '../Constants';

export const Tickets = () => (
    <section id="tickets" className="tickets-section">
        <div className="section-header">
            <h2 className="section-title">Get Your Tickets</h2>
            <h3 className="section-title-cn">购买门票</h3>
            <p className="section-subtitle">
                Early bird prices available now!<br/>
                早鸟价现已开放！
            </p>
        </div>
        <div className="tickets-grid">
            {TICKET_TYPES.map((ticket, index) => (
                <div key={index} className={`ticket-card ${ticket.featured ? 'featured' : ''}`}>
                    <h3 className="ticket-type">{ticket.type}</h3>
                    <p style={{color: '#8a8a8a', marginBottom: '20px'}}>{ticket.typeCn}</p>
                    <div className="ticket-price">{ticket.price}</div>
                    <div className="ticket-price-cn">{ticket.priceCn}</div>
                    <ul className="ticket-features">
                        {ticket.features.map((feature, i) => (
                            <li key={i}>{feature}</li>
                        ))}
                    </ul>
                    <a className="ticket-btn common-btn" href={LINKS.buyTicket}>Select 选择</a>
                </div>
            ))}
        </div>
    </section>
)