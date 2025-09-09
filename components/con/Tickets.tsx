export const Tickets = () => {

    const ticketTypes = [
        {
            type: 'UW Student Admission',
            typeCn: '华大学生票',
            price: '$13',
            priceCn: '约￥95',
            features: [
                'Valid UW student ID required 需出示有效华大学生证',
                'Access to all events 所有活动入场',
                'Vendor hall access 商贩大厅入场',
                'Cosplay contest participation Cosplay大赛参与',
                'Guest meet & greets 嘉宾见面会',
                'Student networking opportunities 学生社交机会'
            ]
        },
        {
            type: 'General Public Admission',
            typeCn: '大众票',
            price: '$21',
            priceCn: '约￥150',
            featured: true,
            features: [
                'Full convention access 全馆通行',
                'Access to all events 所有活动入场',
                'Vendor hall access 商贩大厅入场',
                'Cosplay contest participation Cosplay大赛参与',
                'Guest meet & greets 嘉宾见面会',
                'Networking opportunities 社交机会'
            ]
        },
        {
            type: 'Vendor',
            typeCn: '摊贩',
            price: 'Closed',
            priceCn: '已关闭',
            features: [
                'Registration closed 报名已截止',
                'Contact us for waitlist 候补名单请联系我们',
                'Access to all events 所有活动入场',
                'Cosplay contest participation Cosplay大赛参与',
                'Guest meet & greets 嘉宾见面会',
                'Networking opportunities 社交机会'
            ]
        }
    ];

    return (<section id="tickets" className="tickets-section">
        <div className="section-header">
            <h2 className="section-title">Get Your Tickets</h2>
            <h3 className="section-title-cn">购买门票</h3>
            <p className="section-subtitle">
                Early bird prices available now!<br/>
                早鸟价现已开放！
            </p>
        </div>
        <div className="tickets-grid">
            {ticketTypes.map((ticket, index) => (
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
                    <button className="ticket-btn common-btn">Select 选择</button>
                </div>
            ))}
        </div>
    </section>)
}