export const RSO_EMAIL: string = "sekaibeyond@outlook.com"

export const LINKS = {
    discord: "https://discord.gg/4xPFPmwsW3",
    buyTicket: "https://events.hometownticketing.com/boxoffice/uofwashington/L2VtYmVkL2V2ZW50LzI3P3NpbmdsZT0x",
    huskylink: "https://huskylink.washington.edu/organization/sekaibeyond",
    instagram: "https://www.instagram.com/sekai_beyond/",
    xiaohongshu: "https://www.xiaohongshu.com/user/profile/62d4eefd000000000e00ed42",
    linkedin: "https://www.linkedin.com/company/sekai-beyond/",
    email: `mailto:${RSO_EMAIL}`,
}

export const CONVENTION_DATE = new Date('2025-10-11T12:00:00');

interface Officer {
    name: string;
    role: string;
    roleCn: string;
    src: string;
}

export const OFFICERS: Officer[] = [
    {name: 'Buzzly 小布', role: 'President', roleCn: '社长', src: '/images/officers/Officer_Avatar_Angel.jpg'},
    {name: 'Jason Chen', role: 'Secretary', roleCn: '秘书', src: '/images/officers/Officer_Avatar_JasonChen.jpg'},
    {
        name: 'Ernin Meng',
        role: 'External Relations',
        roleCn: '对外关系',
        src: '/images/officers/Officer_Avatar_ErninMeng.jpg'
    },
    {name: 'Alina', role: 'Art', roleCn: '美术', src: '/images/officers/Officer_Avatar_AlinaYuan.jpg'},
    {name: 'DEMO', role: 'Art', roleCn: '美术', src: '/images/officers/Officer_Avatar_EvaChen.jpg'},
    {
        name: 'Winter',
        role: 'Events Planning & Technical Advisor',
        roleCn: '活动策划 & 技术顾问',
        src: '/images/officers/Officer_Avatar_WynterLin.jpg'
    },
    {name: 'Anne He', role: 'Social Media', roleCn: '社交媒体', src: '/images/officers/Officer_Avatar_Anne.jpg'}
];

export interface PastEvent {
    badge: string;
    badgeCn: string;
    title: string;
    titleCn: string;
    date: string;
    location: string;
    description: string;
    descriptionCn: string;
    icon: string;
}

export const PAST_EVENTS: PastEvent[] = [
    {
        badge: 'Food',
        badgeCn: "美食",
        title: 'Delicious in Dungeon Paaaarty!',
        titleCn: '迷宫饭Paaaarty!',
        date: '2025-8-8',
        location: '4801 24th Ave NE',
        description: 'An immersive culinary adventure inspired by the beloved manga and anime series. Guests enjoyed themed dishes recreating iconic recipes from the dungeon, interactive cooking demonstrations, and a cozy atmosphere perfect for fans to gather and share their love for both food and fantasy adventures.',
        descriptionCn: '受到热门漫画和动画启发的沉浸式美食冒险。客人们品尝了重现地牢中标志性食谱的主题菜肴，观看了互动烹饪演示，并在完美的舒适氛围中聚集，分享对美食和奇幻冒险的热爱。',
        icon: "/images/events/delicious_in_dungeon_party.jpg",
    },
    {
        badge: 'Food',
        badgeCn: "美食",
        title: 'Hobo Bird X Sekai Beyond Pop-up Maid Cafe',
        titleCn: '旅鸟X彼世界 快闪女仆咖啡',
        date: '2025-7-26',
        location: 'Hobo Bird 旅烏, University District',
        description: 'Collaborative maid cafe experience bringing together authentic Japanese service culture with local fusion flavors. Featuring special themed menu items, interactive performances, and immersive moe atmosphere that transported guests to the heart of Akihabara.',
        descriptionCn: '融合正宗日式服务文化与本地创新口味的女仆咖啡体验。特色主题菜单、互动表演和沉浸式萌系氛围，让宾客仿佛置身秋叶原的中心。',
        icon: "/images/events/maid_cafe_hobo_bird_popup_2025.jpg",
    },
    {
        badge: 'Gaming',
        badgeCn: "游戏",
        title: 'D&D Special Epic',
        titleCn: '龙与地下城桌游大会',
        date: '2025-5-24',
        location: 'Alder Hall 107, University of Washington',
        description: 'The D&D Special Event offered a beginner-friendly adventure experience ⚔. Guided by several excellent DMs, participants were able to choose their favorite characters and dive into the fantasy world of Dungeons & Dragons for a collaborative adventur📖e. Set in the universe of Baldur’s Gate, this campaign encouraged players to immerse themselves in roleplaying and cooperative combat.',
        descriptionCn: '《龙与地下城》主题特别活动是一场适合新手入坑的冒险体验⚔。在几位出色DM的带领之下，参与者可以选择自己喜欢的角色，进入D&D的奇幻世界进行合作冒险。本冒险篇章以《博德之门》的世界观为背景，鼓励玩家角色扮演、合作战斗。',
        icon: '/images/events/DND_Special_Epic_2025.jpg',
    },
    {
        badge: 'Gaming',
        badgeCn: "游戏",
        title: 'The Three Kingdoms Kill Tournament',
        titleCn: '三国杀校园赛',
        date: '2025-5-24',
        location: 'Alder Hall 107, University of Washington',
        description: 'The Three Kingdoms Kill Tournament is an on-campus event designed for fans of the classic Chinese strategy game. The competition started with preliminary rounds of standard "Landlord" mode (1v2), then advanced to thrilling 2v2 matches ⚔ in the semi-finals and finals. A total of 12 teams joined the event, each consisting of two players🧑‍🤝‍🧑.',
        descriptionCn: '「《三国杀》校园赛」是一项为UW喜爱中国传统桌面游戏的同学们打造的校内赛事。比赛从初赛的标准“斗地主”模式（1v2）开始，逐渐升级为半决赛及决赛中激烈的2v2对战⚔。现场有12支队伍参与比赛，每队均由2名选手组成🧑‍🤝‍🧑。',
        icon: '/images/events/SanGuoSha_Tournament_2025.jpg',
    },
    {
        badge: 'Music',
        badgeCn: "音乐",
        title: 'Sekai Beyond Live House',
        titleCn: '彼世界音乐节',
        date: '2025-5-6',
        location: "UW Ethnic Cultural Theater",
        description: 'Electric night of J-pop, anisong, and indie performances featuring local and guest artists. From nostalgic anime classics to cutting-edge Vocaloid tracks, this live house event celebrated the diverse spectrum of Japanese music culture with passionate performances that kept the crowd energized until the final encore.',
        descriptionCn: '充满活力的J-pop、动漫歌曲和独立音乐表演之夜，汇集本地和特邀艺术家。从怀旧动漫经典到前沿Vocaloid曲目，这场音乐节以激情四射的演出展现了日本音乐文化的多样性，让观众热情高涨直至最后的安可。',
        icon: '/images/events/Sekai_Beyond_Live_House_2025.jpg',
    },
    {
        badge: 'Food',
        badgeCn: "美食",
        title: 'UW Maid Cafe',
        titleCn: 'UW女仆咖啡',
        date: '2025-3-9',
        location: 'Madrona Hall 313, University of Washington',
        description: '🍰 [UW Maid Cafe] was a delightful mid-sized tea party event hosted by Sekai Beyond. Our staff dressed in charming themed outfits 🎭, interacting warmly with guests through board games 🎲 and photo sessions 📸. Visitors enjoyed a cozy atmosphere with coffee ☕, pastries 🥐, and afternoon tea 🍵, fully immersing themselves in the joyful experience.',
        descriptionCn: '🍰「UW女仆咖啡厅」是一场在UW校内举办的中型茶会活动。我们的工作人员身着各式主题服饰🎭，通过桌游🎲和合影📸与来宾热情互动。客人们可以享用咖啡☕、酥脆糕点🥐和下午茶🍵，沉浸在愉悦而轻松的氛围中。',
        icon: "/images/events/Maid_Cafe_2025_Spring.jpg",
    },
    {
        badge: 'Music',
        badgeCn: "音乐",
        title: 'HaruKaze J-Pop Live',
        titleCn: '户外音乐节',
        date: '2025-3-1',
        location: 'Husky Union Building, University of Washington',
        description: 'The music festival was held on the stone-paved plaza in front of the HUB at the University of Washington 🏫, we have 3 bands with us – Nekoto Allergy, CaroTea, and .59Project. Drawing an audience of over 50 people. Everyone came together to enjoy the pleasant warm weather and a mix of genres of J-Pop music.',
        descriptionCn: '「户外音乐节」在华⼤Husky Union Building前的广场上举办 🏫。我们有幸邀请到了Nekoto Allergy乐队、萝卜茶CarroTea乐队，和.59Project乐队。50位观众齐聚⼀堂，一同在温暖的阳光下观赏活力满满的乐队表演🎵',
        icon: '/images/events/JPop_Live_2025.jpg',
    },
    {
        badge: 'Vendor',
        badgeCn: "展位",
        title: 'Husky Expo',
        titleCn: 'Husky Expo',
        date: '2025-2-5',
        location: 'Husky Union Building, University of Washington',
        description: 'University-wide celebration of anime and gaming culture featuring vendor booths, artist alley, cosplay contests, and panel discussions. This student-organized expo showcased the vibrant otaku community on campus with activities ranging from rhythm game tournaments to manga drawing workshops.',
        descriptionCn: '全校范围的动漫游戏文化庆典，设有摊贩展位、艺术家巷、cosplay比赛和讨论小组。这个学生组织的展览通过从音游锦标赛到漫画绘画工作坊等各种活动，展示了校园里充满活力的御宅文化社区。',
        icon: '/images/events/husky_expo_2025.jpg',
    },
    {
        badge: 'Gaming',
        badgeCn: "游戏",
        title: 'Honor of Kings Competition',
        titleCn: '王者荣耀大赛',
        date: '2025-1-20',
        location: 'Alder Auditorium, University of Washington',
        description: 'The Honor of Kings Competition was divided into three stages: the Quarterfinals (online), the Semifinals (online), and the Finals (offline), held on the University of Washington campus. We encouraged cosplayers to bring in-game characters to life and integrated anime-inspired elements into magic performances. This event provided a platform for those with a passion for esports to showcase their talents🏆.',
        descriptionCn: '《王者荣耀》大赛共分为四分之一决赛（线上）、半决赛（线上）和总决赛（线下）三个赛段。线下决赛在华盛顿大学校园内举行，让电竞爱好者们充分体验游戏的乐趣。我们鼓励热爱Cosplay的伙伴还原游戏中的角色，并将二次元元素融入魔术表演等节目当中。这场比赛为心怀电竞梦想的同学提供了展示自我的舞台🏆。',
        icon: '/images/events/honor_of_kings_2025.jpg',
    }
];

export const TICKET_TYPES = [
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

export const CON_GUESTS = [
    {
        name: 'Gavin',
        title: 'Bilibili Ambassador 哔站大使',
        bio: 'Famous for hosting bilibili events',
        icon: '/images/guests/Gavin.jpg',
    },
    {
        name: 'Yuzhi',
        title: 'Furry 毛茸茸',
        bio: 'Creator of amazing furry suit and furry content',
        icon: '/images/guests/Yuzhi.jpg',
    },
    {
        name: 'DJ Miku',
        title: 'J-Pop Artist 歌手',
        bio: 'Performs anime songs and Vocaloid covers',
        icon: ''
    },
    {
        name: 'Luna Chen',
        title: 'Cosplay Queen Cosplay达人',
        bio: 'International cosplay competition champion',
        icon: ''
    },
    {
        name: 'Ken Zhang',
        title: 'Game Developer 游戏开发者',
        bio: 'Director of popular anime-style games',
        icon: ''
    },
    {
        name: 'Amy Wang',
        title: 'Donghua Creator 国漫创作者',
        bio: 'Rising star in Chinese animation',
        icon: ''
    }
];

export interface ConSchedule {
    time: string;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
}

export const CON_SCHEDULES: ConSchedule[] = [
    {
        time: '11:00 AM',
        title: 'Door Open',
        titleCn: '开门入场',
        description: 'Welcome to Sekai Beyond Con! Registration and check-in begins.',
        descriptionCn: '欢迎来到彼世界动漫展！报到和签到开始。'
    },
    {
        time: '12:00 - 1:00 PM',
        title: 'Band Performance',
        titleCn: '乐队表演',
        description: 'Opening ceremony featuring live J-Pop and anime song performances by local bands.',
        descriptionCn: '开幕式现场J-Pop和动漫歌曲表演，由本地乐队演出。'
    },
    {
        time: '1:30 – 4:10 PM',
        title: 'Kirakira IdolFest',
        titleCn: '闪闪偶像节',
        description: 'Main event featuring idol performances, dance battles, and audience interaction activities.',
        descriptionCn: '主要活动包括偶像表演、舞蹈对决和观众互动环节。'
    },
    {
        time: '4:15 – 4:45 PM',
        title: 'Cosplay Contest',
        titleCn: 'Cosplay大赛',
        description: 'Annual cosplay competition with prizes for best costume, craftsmanship, and performance.',
        descriptionCn: '年度Cosplay比赛，设有最佳服装、工艺和表演奖项。'
    },
    {
        time: '4:45 – 5:45 PM',
        title: 'Random Dance',
        titleCn: '随机舞蹈',
        description: 'Join the crowd for spontaneous K-Pop and J-Pop dance sessions. All skill levels welcome!',
        descriptionCn: '加入人群进行即兴K-Pop和J-Pop舞蹈。欢迎所有水平的参与者！'
    },
    {
        time: '5:45 – 6:00 PM',
        title: 'Door close',
        titleCn: '闭门离场',
        description: 'Thank you for attending! Safe travels and see you next year.',
        descriptionCn: '感谢您的参与！一路平安，明年再见。'
    }
]