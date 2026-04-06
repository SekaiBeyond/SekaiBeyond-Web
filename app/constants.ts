export const RSO_EMAIL: string = "sekaibeyond@outlook.com"

export const BILIBILI_VIDEO = {
    aid: "116106639514970",
    bvid: "BV1GsfjB7E6J",
    cid: "36189832448",
    p: "1",
}

export const LINKS = {
    discord: "https://discord.gg/4xPFPmwsW3",
    huskylink: "https://huskylink.washington.edu/organization/sekaibeyond",
    instagram: "https://www.instagram.com/sekai_beyond/",
    bilibili: "https://space.bilibili.com/3546779589020292",
    xiaohongshu: "https://www.xiaohongshu.com/user/profile/62d4eefd000000000e00ed42",
    linkedin: "https://www.linkedin.com/company/sekai-beyond/",
    github: "https://github.com/SekaiBeyond",
    email: `mailto:${RSO_EMAIL}`
}


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
    {
        name: 'Jason',
        role: 'Secretary',
        roleCn: '秘书',
        src: '/images/officers/Officer_Avatar_JasonChen.jpg'
    },
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
    {
        name: 'Anne',
        role: 'Social Media',
        roleCn: '社交媒体',
        src: '/images/officers/Officer_Avatar_Anne.jpg'
    },
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

export interface ConEdition {
    year: number;
    date: string;
    location: string;
    locationCn?: string;
    description: string;
    descriptionCn: string;
    image: string;
    highlights: {
        labelEn: string;
        labelCn: string;
        icon: string;
    }[];
}

export const SEKAI_BEYOND_CON: ConEdition[] = [
    {
        year: 2025,
        date: '2025-10-11',
        location: 'Husky Union Building',
        description: 'Sekai Beyond\'s first convention brought anime, comics, games, and novel fans together for a full day of creativity and celebration. From the dazzling KiraKira IdolFest and spirited cosplay competition to the bustling artist alley and energetic band performances, guests cheered, connected, and shared their passions in a vibrant community atmosphere.',
        descriptionCn: 'Sekai Beyond 首届漫展汇聚了动漫、漫画、游戏与小说（ACGN）爱好者，共度充满创意与热情的一天。从闪耀的 KiraKira 偶像祭、热血的角色扮演比赛，到热闹的艺术家街与活力四射的乐队演出，现场观众为之欢呼、交流，共同在充满活力的社区氛围中分享他们的热爱。',
        image: '/images/sekai_beyond_con_2025.jpg',
        highlights: [
            {labelEn: 'KiraKira IdolFest', labelCn: '闪耀偶像祭', icon: '🎤'},
            {labelEn: 'Cosplay Competition', labelCn: '角色扮演比赛', icon: '🌸'},
            {labelEn: 'Artist Alley', labelCn: '艺术家街', icon: '🎨'},
            {labelEn: 'Band Performances', labelCn: '乐队演出', icon: '🎸'},
        ],
    },
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
        id: 'con',
        href: '#con',
        labelEn: 'Sekai Beyond Con',
        labelCn: '彼世界漫展',
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
        labelEn: 'Upcoming Events',
        labelCn: '活动预告',
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
        id: 'github',
        href: LINKS.github,
        labelEn: 'GitHub',
        labelCn: 'GitHub',
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
