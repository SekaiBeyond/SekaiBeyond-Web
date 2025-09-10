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

export const PAST_EVENTS = [
    {
        badge: 'Food',
        title: 'Hobo Bird X Sekai Beyond Pop-up Maid Cafe',
        titleCn: '旅鸟X彼世界 快闪女仆咖啡',
        date: 'June 26th, 2025',
        description: 'Collaborative maid cafe experience bringing together authentic Japanese service culture with local fusion flavors. Featuring special themed menu items, interactive performances, and immersive moe atmosphere that transported guests to the heart of Akihabara.',
        descriptionCn: '融合正宗日式服务文化与本地创新口味的女仆咖啡体验。特色主题菜单、互动表演和沉浸式萌系氛围，让宾客仿佛置身秋叶原的中心。',
        icon: "/images/events/maid_cafe_hobo_bird_popup_2025.jpg",
    },
    {
        badge: 'Gaming',
        title: 'SanGuoSha Tournament',
        titleCn: '三国杀比赛',
        date: 'May 24, 2025',
        description: 'Intense strategic card game tournament bringing together masters of the Three Kingdoms. Players battled through multiple rounds of cunning tactics and careful alliance-building, showcasing their mastery of this beloved Chinese card game in a competitive yet friendly atmosphere.',
        descriptionCn: '激烈的三国杀策略卡牌游戏锦标赛，汇聚三国高手。玩家们通过多轮巧妙的战术和谨慎的联盟建立进行对决，在竞争又友好的氛围中展示他们对这款深受喜爱的中国卡牌游戏的精通。',
        icon: '/images/events/SanGuoSha_Tournament_2025.jpg',
    },
    {
        badge: 'Music',
        title: 'Sekai Beyond Live House',
        titleCn: '彼世界音乐节',
        date: 'May 6th, 2025',
        description: 'Electric night of J-pop, anisong, and indie performances featuring local and guest artists. From nostalgic anime classics to cutting-edge Vocaloid tracks, this live house event celebrated the diverse spectrum of Japanese music culture with passionate performances that kept the crowd energized until the final encore.',
        descriptionCn: '充满活力的J-pop、动漫歌曲和独立音乐表演之夜，汇集本地和特邀艺术家。从怀旧动漫经典到前沿Vocaloid曲目，这场音乐节以激情四射的演出展现了日本音乐文化的多样性，让观众热情高涨直至最后的安可。',
        icon: '/images/events/Sekai_Beyond_Live_House_2025.jpg',
    },
    {
        badge: 'Food',
        title: 'Maid Cafe - 2025 Spring',
        titleCn: '女仆咖啡 - 2025春',
        date: 'March 9th, 2025',
        description: 'Spring-themed maid cafe celebrating sakura season with special cherry blossom desserts and performances. Guests enjoyed traditional maid cafe activities including omelet rice decoration, interactive games, and memorable photo sessions with our dedicated maid staff in custom spring uniforms.',
        descriptionCn: '以春天为主题的女仆咖啡，用特制樱花甜点和表演庆祝樱花季。客人们享受传统女仆咖啡活动，包括蛋包饭装饰、互动游戏，以及与我们身着定制春装的专业女仆团队的难忘合影时光。',
        icon: "/images/events/Maid_Cafe_2025_Spring.jpg",
    },
    {
        badge: 'Cultural',
        title: 'HaruKaze J-Pop Live',
        titleCn: 'HaruKaze J-Pop Live',
        date: 'March 1st, 2025',
        description: 'Spring breeze carries melodies as local J-pop artists and cover bands deliver heartfelt performances. This cultural celebration featured acoustic sets, dance performances, and audience participation segments that brought the community together through the universal language of Japanese pop music.',
        descriptionCn: '春风送来旋律，本地J-pop艺术家和翻唱乐队带来深情演出。这场文化庆典包含原声音乐、舞蹈表演和观众互动环节，通过日本流行音乐这一世界语言将社区凝聚在一起。',
        icon: '/images/events/JPop_Live_2025.jpg',
    },
    {
        badge: 'Convention',
        title: 'Husky Expo',
        titleCn: 'Husky Expo',
        date: 'February 5th, 2025',
        description: 'University-wide celebration of anime and gaming culture featuring vendor booths, artist alley, cosplay contests, and panel discussions. This student-organized expo showcased the vibrant otaku community on campus with activities ranging from rhythm game tournaments to manga drawing workshops.',
        descriptionCn: '全校范围的动漫游戏文化庆典，设有摊贩展位、艺术家巷、cosplay比赛和讨论小组。这个学生组织的展览通过从音游锦标赛到漫画绘画工作坊等各种活动，展示了校园里充满活力的御宅文化社区。',
        icon: '/images/events/husky_expo_2025.jpg',
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