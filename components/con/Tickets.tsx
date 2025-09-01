export const Tickets = () => {

    const ticketTypes = [
        {
            type: 'Single Day',
            typeCn: '单日票',
            price: '$25',
            priceCn: '约￥180',
            features: [
                'Access to all events for one day 单日所有活动',
                'Vendor hall access 商贩大厅入场',
                'Panel attendance 参加讨论会',
                'Gaming zone access 游戏区入场'
            ]
        },
        {
            type: 'Weekend Pass',
            typeCn: '周末通票',
            price: '$60',
            priceCn: '约￥430',
            featured: true,
            features: [
                'All 3 days access 三天通票',
                'Priority seating at panels 讨论会优先座位',
                'Exclusive con badge 独家徽章',
                'Early vendor hall entry 提前进入商贩大厅',
                '10% merchandise discount 周边9折优惠'
            ]
        },
        {
            type: 'VIP Pass',
            typeCn: 'VIP通票',
            price: '$120',
            priceCn: '约￥860',
            features: [
                'All weekend pass benefits 所有周末通票福利',
                'Guest meet & greet 嘉宾见面会',
                'VIP lounge access VIP休息室',
                'Exclusive merchandise 独家周边',
                'Front row concert seats 演唱会前排座位'
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
                    <button className="ticket-btn">Select 选择</button>
                </div>
            ))}
        </div>
    </section>)
}