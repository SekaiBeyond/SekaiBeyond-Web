export const Guests = () => {
    const guests = [
        {
            name: 'Yuki Tanaka',
            title: 'Voice Actor 声优',
            bio: 'Famous for iconic anime roles in popular series',
            icon: '🎤'
        },
        {
            name: 'Sakura Li',
            title: 'Manga Artist 漫画家',
            bio: 'Creator of bestselling shoujo manga series',
            icon: '✏️'
        },
        {
            name: 'DJ Miku',
            title: 'J-Pop Artist 歌手',
            bio: 'Performs anime songs and Vocaloid covers',
            icon: '🎵'
        },
        {
            name: 'Luna Chen',
            title: 'Cosplay Queen Cosplay达人',
            bio: 'International cosplay competition champion',
            icon: '👑'
        },
        {
            name: 'Ken Zhang',
            title: 'Game Developer 游戏开发者',
            bio: 'Director of popular anime-style games',
            icon: '🎮'
        },
        {
            name: 'Amy Wang',
            title: 'Donghua Creator 国漫创作者',
            bio: 'Rising star in Chinese animation',
            icon: '🎬'
        }
    ];

    return (<section id="guests" className="guests-section">
        <div className="section-header">
            <h2 className="section-title">Special Guests</h2>
            <h3 className="section-title-cn">特邀嘉宾</h3>
            <p className="section-subtitle">
                Meet industry professionals and rising stars!<br/>
                与业界专业人士和新星见面！
            </p>
        </div>
        <div className="guests-grid">
            {guests.map((guest, index) => (
                <div key={index} className="guest-card">
                    <div className="guest-avatar">{guest.icon}</div>
                    <h3 className="guest-name">{guest.name}</h3>
                    <p className="guest-title">{guest.title}</p>
                    <p className="guest-bio">{guest.bio}</p>
                </div>
            ))}
        </div>
    </section>)

}