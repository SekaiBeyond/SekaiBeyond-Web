export const PastEvents = () => {
    const pastEvents = [
        {
            badge: 'Food',
            title: 'Hobo Bird X Sekai Beyond Pop-up Maid Cafe',
            titleCn: '旅鸟X彼世界 快闪女仆咖啡',
            date: 'June 26th, 2025',
            description: 'Collaborative maid cafe experience bringing together authentic Japanese service culture with local fusion flavors. Featuring special themed menu items, interactive performances, and immersive moe atmosphere that transported guests to the heart of Akihabara.',
            descriptionCn: '融合正宗日式服务文化与本地创新口味的女仆咖啡体验。特色主题菜单、互动表演和沉浸式萌系氛围，让宾客仿佛置身秋叶原的中心。',
            icon: "https://sns-webpic-qc.xhscdn.com/202509021548/4f7050a7eae2adc675247957c2e40e08/notes_pre_post/1040g3k831l8405ps528g5pptcnnn33rrdp326ho!nd_dft_wgth_webp_3",
        },
        {
            badge: 'Music',
            title: 'Sekai Beyond Live House',
            titleCn: '彼世界音乐节',
            date: 'May 6th, 2025',
            description: 'Electric night of J-pop, anisong, and indie performances featuring local and guest artists. From nostalgic anime classics to cutting-edge Vocaloid tracks, this live house event celebrated the diverse spectrum of Japanese music culture with passionate performances that kept the crowd energized until the final encore.',
            descriptionCn: '充满活力的J-pop、动漫歌曲和独立音乐表演之夜，汇集本地和特邀艺术家。从怀旧动漫经典到前沿Vocaloid曲目，这场音乐节以激情四射的演出展现了日本音乐文化的多样性，让观众热情高涨直至最后的安可。',
            icon: 'https://sns-webpic-qc.xhscdn.com/202509021541/f0eec32dda4bf047539b81448f6a538f/1040g00831gb0b610ik005omktrujhra2753dei8!nd_dft_wlteh_webp_3',
        },
        {
            badge: 'Gaming',
            title: 'SanGuoSha Tournament',
            titleCn: '三国杀比赛',
            date: 'December 15, 2023',
            description: 'Intense strategic card game tournament bringing together masters of the Three Kingdoms. Players battled through multiple rounds of cunning tactics and careful alliance-building, showcasing their mastery of this beloved Chinese card game in a competitive yet friendly atmosphere.',
            descriptionCn: '激烈的三国杀策略卡牌游戏锦标赛，汇聚三国高手。玩家们通过多轮巧妙的战术和谨慎的联盟建立进行对决，在竞争又友好的氛围中展示他们对这款深受喜爱的中国卡牌游戏的精通。',
            icon: 'https://sns-webpic-qc.xhscdn.com/202509021538/59a56b335a17bb9b35827737b13a096e/notes_pre_post/1040g3k031fftkgg5745g5omktrujhra2kh2gj18!nd_dft_wlteh_webp_3',
        },
        {
            badge: 'Food',
            title: 'Maid Cafe - 2025 Spring',
            titleCn: '女仆咖啡 - 2025春',
            date: 'March 9th, 2023',
            description: 'Spring-themed maid cafe celebrating sakura season with special cherry blossom desserts and performances. Guests enjoyed traditional maid cafe activities including omelet rice decoration, interactive games, and memorable photo sessions with our dedicated maid staff in custom spring uniforms.',
            descriptionCn: '以春天为主题的女仆咖啡，用特制樱花甜点和表演庆祝樱花季。客人们享受传统女仆咖啡活动，包括蛋包饭装饰、互动游戏，以及与我们身着定制春装的专业女仆团队的难忘合影时光。',
            icon: "https://sns-webpic-qc.xhscdn.com/202509021222/8cc06f0b70596282b07b8d0e6eb68283/1040g00831et9baobmo0g5omktrujhra238r57d0!nd_dft_wgth_webp_3",
        },
        {
            badge: 'Cultural',
            title: 'HaruKaze J-Pop Live',
            titleCn: 'HaruKaze J-Pop Live',
            date: 'March 1st, 2025',
            description: 'Spring breeze carries melodies as local J-pop artists and cover bands deliver heartfelt performances. This cultural celebration featured acoustic sets, dance performances, and audience participation segments that brought the community together through the universal language of Japanese pop music.',
            descriptionCn: '春风送来旋律，本地J-pop艺术家和翻唱乐队带来深情演出。这场文化庆典包含原声音乐、舞蹈表演和观众互动环节，通过日本流行音乐这一世界语言将社区凝聚在一起。',
            icon: 'https://sns-webpic-qc.xhscdn.com/202509021214/386979b14f70b484183de801559f4127/notes_pre_post/1040g3k831eftcl170m905omktrujhra2ske4f60!nd_dft_wlteh_webp_3',
        },
        {
            badge: 'Convention',
            title: 'Husky Expo',
            titleCn: 'Husky Expo',
            date: 'February 5th, 2025',
            description: 'University-wide celebration of anime and gaming culture featuring vendor booths, artist alley, cosplay contests, and panel discussions. This student-organized expo showcased the vibrant otaku community on campus with activities ranging from rhythm game tournaments to manga drawing workshops.',
            descriptionCn: '全校范围的动漫游戏文化庆典，设有摊贩展位、艺术家巷、cosplay比赛和讨论小组。这个学生组织的展览通过从音游锦标赛到漫画绘画工作坊等各种活动，展示了校园里充满活力的御宅文化社区。',
            icon: 'https://sns-webpic-qc.xhscdn.com/202509021201/3bfce968c506409c00c206bd93827d1f/1040g2sg31drv65ahgs7g5omktrujhra2571d6fg!nd_dft_wlteh_webp_3',
        }
    ];
    return (
        <section id="events" className="section">
            <div className="section-header">
                <h2 className="section-title">Past Events</h2>
                <h3 className="section-title-cn">往期活动</h3>
                <p className="section-subtitle">
                    Check out the amazing events we've hosted!<br/>
                    查看我们举办过的精彩活动！
                </p>
            </div>

            <div className="events-grid">
                {pastEvents.map((event, index) => (
                    <div key={index} className="event-card">
                        <img className="event-image" src={event.icon}/>
                        <div className="event-content">
                            <span className="event-badge">{event.badge}</span>
                            <h3 className="event-title">{event.title}</h3>
                            <p className="event-title-cn">{event.titleCn}</p>
                            <div className="event-date">
                                <span>📅</span>
                                <span>{event.date}</span>
                            </div>
                            <p className="event-description">
                                {event.description}<br/>
                                <span style={{fontSize: '13px', color: '#9a9a9a'}}>
                                                {event.descriptionCn}
                                            </span>
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </section>

    )
}