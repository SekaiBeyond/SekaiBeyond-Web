export const RSO_EMAIL: string = "sekaibeyond@outlook.com"

export const LINKS = {
    discord: "https://discord.gg/4xPFPmwsW3",
    huskylink: "https://huskylink.washington.edu/organization/sekaibeyond",
    instagram: "https://www.instagram.com/sekai_beyond/",
    bilibili: "https://space.bilibili.com/3546779589020292",
    xiaohongshu: "https://www.xiaohongshu.com/user/profile/62d4eefd000000000e00ed42",
    linkedin: "https://www.linkedin.com/company/sekai-beyond/",
    email: `mailto:${RSO_EMAIL}`
}

export const UPCOMING_EVENT = {
    START_AT: new Date('2025-10-31T18:00:00'),
    END_AT: new Date('2025-10-31T21:00:00'),
    NAME: "Halloween Party 2025",
    NAME_CN: "万圣节晚会 2025",
    DESCRIPTION: "Enjoy the sweet night of candies with us!",
    DESCRIPTION_CN: "一起度过一个糖分过量的万圣节吧！",
    BUY_TICKET: "",
    LEARN_MORE: "",
    POSTER: "/images/events/halloween_2025.jpg",
    POSTER_CREDIT: "Oscar"
}

export const NO_UPCOMING_EVENT: boolean = UPCOMING_EVENT.END_AT <= new Date();

interface Officer {
    name: string;
    nameCn?: string;
    role: string;
    roleCn: string;
    src: string;
}

export const OFFICERS: Officer[] = [
    {
        name: 'Buzzly',
        nameCn: "小布",
        role: 'President',
        roleCn: '社长',
        src: '/images/officers/Officer_Avatar_Angel.jpg'
    },
    {name: 'Jason', role: 'Secretary', roleCn: '秘书', src: '/images/officers/Officer_Avatar_JasonChen.jpg'},
    {
        name: 'Ernin',
        role: 'External Relations',
        roleCn: '对外关系',
        src: '/images/officers/Officer_Avatar_ErninMeng.jpg'
    },
    {name: 'Alina', role: 'Artist', roleCn: '美术', src: '/images/officers/Officer_Avatar_AlinaYuan.jpg'},
    {name: 'DEMO', role: 'Artist', roleCn: '美术', src: '/images/officers/Officer_Avatar_EvaChen.jpg'},
    {
        name: 'Wynter',
        role: 'Technical Advisor',
        roleCn: '技术顾问',
        src: '/images/officers/Officer_Avatar_WynterLin.jpg'
    },
    {name: 'Anne', role: 'Social Media', roleCn: '社交媒体', src: '/images/officers/Officer_Avatar_Anne.jpg'},
    {
        name: 'Aaron',
        nameCn: "笹兰",
        role: 'Events Planning',
        roleCn: '活动策划',
        src: '/images/officers/Officer_Avatar_Aaron.jpg'
    },
    {
        name: 'Gavin',
        nameCn: "嘎嘎",
        role: 'Bilibili Ambassador',
        roleCn: 'B站大使',
        src: '/images/officers/Officer_Avatar_Gavin.jpeg'
    }
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
        badge: 'Cosplay',
        badgeCn: "角色扮演",
        title: 'Halloween Party 2025',
        titleCn: '万圣节晚会 2025',
        date: '2025-10-31',
        location: 'McMahon Hall Pompeii Room',
        description: 'A spooky night of anime‑inspired Halloween fun! Members dressed up as their favorite characters, played mini games with Halloween twists, and celebrated the season together. From creative cosplay to themed activities, everyone enjoyed treats, tricks, and plenty of photo ops in a festive atmosphere.',
        descriptionCn: '充满动漫元素的万圣节派对！成员们装扮成自己最喜爱的角色，参与带有万圣节元素的迷你游戏，一起庆祝这个欢乐的节日。从创意角色扮演到主题活动，每个人都享受了糖果、惊喜以及大量的合影机会，度过了一个充满节日气氛的夜晚。',
        icon: "/images/events/halloween_2025.jpg",
    },
    {
        badge: 'Anime Con',
        badgeCn: "漫展",
        title: 'Sekai Beyond Con',
        titleCn: '彼世界动漫游戏展',
        date: '2025-10-11',
        location: 'Husky Union Building',
        description: 'Sekai Beyond\'s first convention brought anime, comics, games, and novel fans together for a full day of creativity and celebration. From the dazzling KiraKira IdolFest and spirited cosplay competition to the bustling artist alley and energetic band performances, guests cheered, connected, and shared their passions in a vibrant community atmosphere.',
        descriptionCn: 'Sekai Beyond 首届漫展汇聚了动漫、漫画、游戏与小说（ACGN）爱好者，共度充满创意与热情的一天。从闪耀的 KiraKira 偶像祭、热血的角色扮演比赛，到热闹的艺术家街与活力四射的乐队演出，现场观众为之欢呼、交流，共同在充满活力的社区氛围中分享他们的热爱。',
        icon: "/images/events/sekai_beyond_con_2025.jpg",
    },
    {
        badge: 'Food',
        badgeCn: "美食",
        title: 'Delicious in Dungeon Paaaarty!',
        titleCn: '迷宫饭Paaaarty!',
        date: '2025-8-8',
        location: '4801 24th Ave NE',
        description: 'A Delicious in Dungeon–themed social where fans dove into the official board game, a lively cooking challenge, and lighthearted role‑play. Between strategy, storytelling, and plenty of tasty dishes, guests traded tips, shared laughs, and adventured together all evening.',
        descriptionCn: '本次迷宫饭主题活动成功聚集了许多热爱这部作品的同好，大家一同体验了官方正版桌游，并积极参与了趣味十足的厨艺比赛。一边品尝香气四溢的美食，一边在跑团、战略桌游，和角色扮演中迷失自我……',
        icon: "/images/events/delicious_in_dungeon_party.jpg",
    },
    {
        badge: 'Food',
        badgeCn: "美食",
        title: 'Hobo Bird X Sekai Beyond Pop-up Maid Cafe',
        titleCn: '旅鸟X彼世界 快闪女仆咖啡',
        date: '2025-7-26',
        location: 'Hobo Bird 旅烏, University District',
        description: 'Our second pop‑up maid café featured longer seating, warmer service, and a smoother flow. Maids charmed guests with J‑pop dance stages and playful “magic,” while Basque cheesecake and matcha lattes set a sweet afternoon vibe. A cozy, unhurried day at Hobo Bird for chats, photos, and treats.',
        descriptionCn: '我们与Hobo Bird动漫店合作举办了第二次pop-up cafe，为参与者提供更长时间的陪伴并给予更多的服务项目。女仆们表演了精彩的节目，还给顾客的食品中施了魔法。巴斯克蛋糕配上抹茶拿铁变得更加美味！动漫店摇身一变成了下午茶餐厅，大家一同度过了一个愉快的下午。',
        icon: "/images/events/maid_cafe_hobo_bird_popup_2025.jpg",
    },
    {
        badge: 'Gaming',
        badgeCn: "游戏",
        title: 'D&D Special Epic',
        titleCn: '龙与地下城桌游大会',
        date: '2025-5-24',
        location: 'Alder Hall 107, University of Washington',
        description: 'A beginner‑friendly D&D one‑shot led by veteran DMs. Players picked iconic classes, role‑played through the Baldur’s Gate setting, and teamed up for tactical encounters—perfect for first‑timers and returning adventurers alike.',
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
        description: 'An on‑campus showdown for fans of the classic strategy card game. Prelims ran in standard “Landlord” format, leading into tense 2v2 semi‑finals and finals—12 two‑player teams battling for campus glory.',
        descriptionCn: '「《三国杀》校园赛」是一项为UW喜爱中国传统桌面游戏的同学们打造的校内赛事。比赛从初赛的标准“斗地主”模式（1v2）开始，逐渐升级为半决赛及决赛中激烈的2v2对战。现场有12支队伍参与比赛，每队均由2名选手组成‍‍。',
        icon: '/images/events/SanGuoSha_Tournament_2025.jpg',
    },
    {
        badge: 'Music',
        badgeCn: "音乐",
        title: 'Sekai Beyond Live House',
        titleCn: '彼世界音乐节',
        date: '2025-5-6',
        location: "UW Ethnic Cultural Theater",
        description: 'A high‑energy night of J‑pop, anisong, and indie sets from local and guest artists. From nostalgic anime themes to fresh Vocaloid covers, the crowd sang, waved, and cheered straight through the encore.',
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
        description: 'A tea‑time social hosted by maids in themed outfits. Guests enjoyed coffee, pastries, photos, and board games in a warm, cozy atmosphere—perfect for unwinding and making new friends.',
        descriptionCn: '「UW女仆咖啡厅」是一场在UW校内举办的中型茶会活动。我们的工作人员身着各式主题服饰，通过桌游和合影与来宾热情互动。客人们可以享用咖啡、酥脆糕点和下午茶，沉浸在愉悦而轻松的氛围中。',
        icon: "/images/events/Maid_Cafe_2025_Spring.jpg",
    },
    {
        badge: 'Music',
        badgeCn: "音乐",
        title: 'HaruKaze J-Pop Live',
        titleCn: '户外音乐节',
        date: '2025-3-1',
        location: 'Husky Union Building, University of Washington',
        description: 'An outdoor showcase on the HUB plaza featuring Nekoto Allergy, CaroTea, and .59Project. Over 50 attendees soaked in the early‑spring sun and a lively mix of J‑pop sounds.',
        descriptionCn: '「户外音乐节」在华⼤Husky Union Building前的广场上举办 。我们有幸邀请到了Nekoto Allergy乐队、萝卜茶CarroTea乐队，和.59Project乐队。50位观众齐聚⼀堂，一同在温暖的阳光下观赏活力满满的乐队表演。',
        icon: '/images/events/JPop_Live_2025.jpg',
    },
    {
        badge: 'Vendor',
        badgeCn: "展位",
        title: 'Husky Expo',
        titleCn: 'Husky Expo',
        date: '2025-2-5',
        location: 'Husky Union Building, University of Washington',
        description: 'Our first convention appearance: we introduced our original mascot Mika, met fellow ACGN fans, and launched our social channels—laying the groundwork for a growing community.',
        descriptionCn: 'Husky Expo是彼世界社团建立后参与的首次展会活动。我们大力宣传了自己的原创角色米卡，也让热爱ACGN的伙伴们成功找到了同好。彼世界社交媒体建立，也为后续的社团发展奠定了重要的基础。',
        icon: '/images/events/husky_expo_2025.jpg',
    },
    {
        badge: 'Gaming',
        badgeCn: "游戏",
        title: 'Honor of Kings Competition',
        titleCn: '王者荣耀大赛',
        date: '2025-1-20',
        location: 'Alder Auditorium, University of Washington',
        description: 'A three‑stage tournament—online quarters and semis, then an offline campus final. Cosplayers brought heroes to life, stage acts added flair, and esports hopefuls battled for the trophy.',
        descriptionCn: '《王者荣耀》大赛共分为四分之一决赛（线上）、半决赛（线上）和总决赛（线下）三个赛段。线下决赛在华盛顿大学校园内举行，让电竞爱好者们充分体验游戏的乐趣。我们鼓励热爱Cosplay的伙伴还原游戏中的角色，并将二次元元素融入魔术表演等节目当中。这场比赛为心怀电竞梦想的同学提供了展示自我的舞台。',
        icon: '/images/events/honor_of_kings_2025.jpg',
    }
];

export interface NavLink {
    id: string;
    href: string;
    labelEn: string;
    labelCn: string;
    disabled?: boolean;
}

const SHARED_LINKS: NavLink[] = [
    {
        id: 'about',
        href: '#about',
        labelEn: 'About Us',
        labelCn: '关于我们',
    },
    {
        id: 'events',
        href: '#events',
        labelEn: 'Past Events',
        labelCn: '往期活动',
    },
    {
        id: 'upcoming',
        href: '#upcoming',
        labelEn: 'Upcoming Event',
        labelCn: '活动预告',
        disabled: NO_UPCOMING_EVENT,
    },
    {
        id: 'team',
        href: '#team',
        labelEn: 'Team',
        labelCn: '幕后团队',
    },
]

export const FOOTER_LINKS: NavLink[] = [
    ...SHARED_LINKS,
    {
        id: 'huskylink',
        href: LINKS.huskylink,
        labelEn: 'HuskyLink',
        labelCn: 'HuskyLink',
    },
    {
        id: 'email',
        href: LINKS.email,
        labelEn: 'Contact Us',
        labelCn: '联系我们',
    }
];

export const NAVIGATION_LINKS: NavLink[] = [
    {
        id: 'home',
        href: '#home',
        labelEn: 'Home',
        labelCn: '首页'
    },
    ...SHARED_LINKS,
    {
        id: 'contact',
        href: '#contact',
        labelEn: 'Follow Us',
        labelCn: '关注我们'
    }
];