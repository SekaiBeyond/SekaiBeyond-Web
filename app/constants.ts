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

/** Configuration for an upcoming event displayed on the website */
export interface UpcomingEventType {
    /** Event start date and time */
    START_AT: Date;
    /** Event end date and time (event hidden after this) */
    END_AT: Date;
    /** Event name in English */
    NAME: string;
    /** Event name in Chinese */
    NAME_CN: string;
    /** Event description in English */
    DESCRIPTION: string;
    /** Event description in Chinese */
    DESCRIPTION_CN: string;
    /** Event location in English */
    LOCATION: string;
    /** Event location in Chinese */
    LOCATION_CN: string;
    /** URL for ticket purchase (optional) */
    BUY_TICKET?: string;
    /** URL for more information (optional) */
    LEARN_MORE?: string;
    /** Custom button text in English (optional) */
    CUSTOM_BUTTON_TEXT?: string;
    /** Custom button text in Chinese (optional) */
    CUSTOM_BUTTON_TEXT_CN?: string;
    /** Custom button URL (optional) */
    CUSTOM_BUTTON_LINK?: string;
    /** Path to event poster image */
    POSTER: string;
    /** Credit for poster creator (optional) */
    POSTER_CREDIT?: string;
}

export const UPCOMING_EVENTS: UpcomingEventType[] = [
    {
        START_AT: new Date('2026-03-21T15:00:00'),
        END_AT: new Date('2026-03-21T18:00:00'),
        NAME: "Bowtea Maid Café",
        NAME_CN: "Bowtea 女仆咖啡",
        DESCRIPTION: "Our beloved maid café returns for a second year! Enjoy an afternoon of themed drinks, sweet treats, and charming maid service across two cozy rooms. With interactive games, photo ops, and heartfelt hospitality, it's the perfect way to unwind and make new friends.",
        DESCRIPTION_CN: "广受好评的UW女仆咖啡厅再度回归！在两间精心布置的房间里，品尝主题饮品与精致甜点，感受女仆们温馨贴心的服务。互动小游戏、合影留念与满满的元气，带你度过一个治愈又欢乐的下午。",
        LOCATION: "Spratlen Hall 311 & 313",
        LOCATION_CN: "Spratlen Hall 311 & 313",
        POSTER: "/images/maid_cafe_2026.png",
        CUSTOM_BUTTON_TEXT: "Reserve",
        CUSTOM_BUTTON_TEXT_CN: "预约",
        CUSTOM_BUTTON_LINK: "https://forms.gle/99nmMywkLCyaxXPg6"
    },
    {
        START_AT: new Date('2026-05-23T15:00:00'),
        END_AT: new Date('2026-05-23T19:00:00'),
        NAME: "Sekai Band Con",
        NAME_CN: "少女乐队Only",
        DESCRIPTION: "Bringing the community together through Girls Band  themed live performances, fan-zine marketplaces, and rhythm game challenges.",
        DESCRIPTION_CN: "少女乐队主题的热血乐队Live、同人制品售卖及趣味音游竞赛，为西雅图同好打造一场沉浸式的音乐与二次元文化盛宴。",
        LOCATION: "UW Denny Room",
        LOCATION_CN: "UW Denny Room",
        POSTER: "/images/sekai_ban_con_2026.png"
    }
].filter(event => event.END_AT > new Date()); // Filter to only show events that haven't ended yet

// Validate that END_AT is always later than START_AT
UPCOMING_EVENTS.forEach((event, index) => {
    if (event.END_AT <= event.START_AT) {
        throw new Error(`Invalid event at index ${index} ("${event.NAME}"): END_AT must be later than START_AT`);
    }
});

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
        labelEn: UPCOMING_EVENTS.length > 1 ? 'Upcoming Events' : 'Upcoming Event',
        labelCn: '活动预告',
        disabled: UPCOMING_EVENTS.length === 0,
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
