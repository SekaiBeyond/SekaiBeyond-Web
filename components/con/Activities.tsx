export const Activities = () => {

    const activities = [
        {
            icon: '🛍️',
            title: 'Artist Alley',
            titleCn: '画师小巷',
            description: 'Over 100 talented artists selling original art, prints, and handmade goods 超过100位才华横溢的艺术家'
        },
        {
            icon: '🎮',
            title: 'Gaming Zone',
            titleCn: '游戏区',
            description: 'Play the latest anime games, join tournaments, and win prizes 玩最新游戏，参加比赛，赢取奖品'
        },
        {
            icon: '🍜',
            title: 'Food Court',
            titleCn: '美食广场',
            description: 'Japanese street food, bubble tea, and themed café experiences 日式街头美食、珍珠奶茶和主题咖啡厅'
        },
        {
            icon: '📸',
            title: 'Photo Spots',
            titleCn: '拍照点',
            description: 'Instagram-worthy themed backgrounds and props 超适合发朋友圈的主题背景'
        },
        {
            icon: '👘',
            title: 'Cosplay Corner',
            titleCn: 'Cosplay角',
            description: 'Changing rooms, repair station, and photo shoots Cosplay更衣室、维修站和摄影'
        },
        {
            icon: '🎬',
            title: 'Screening Room',
            titleCn: '放映厅',
            description: 'Watch exclusive premieres and classic anime 观看独家首映和经典动漫'
        }
    ];

    return (
        <section id="activities" className="activities-section">
            <div className="section-header">
                <h2 className="section-title">Amazing Activities</h2>
                <h3 className="section-title-cn">精彩活动</h3>
                <p className="section-subtitle">
                    Something for every otaku!<br/>
                    每个宅都有适合的活动！
                </p>
            </div>
            <div className="activities-grid">
                {activities.map((activity, index) => (
                    <div key={index} className="activity-card">
                        <div className="activity-icon">{activity.icon}</div>
                        <h3 className="activity-title">{activity.title}</h3>
                        <p className="activity-title-cn">{activity.titleCn}</p>
                        <p className="activity-description">{activity.description}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}