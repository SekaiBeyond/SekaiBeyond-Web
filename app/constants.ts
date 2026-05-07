export const MAX_IMAGE_SIZE_MB = Number(import.meta.env.VITE_MAX_IMAGE_SIZE_MB ?? 10);

export const FOUNDED_DATE = new Date('2024-12-05T00:00:00Z');

const RSO_EMAIL: string = "sekaibeyond@outlook.com"

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
    },
    {
        id: 'policy',
        href: '/policy',
        labelEn: 'Policy',
        labelCn: '政策',
    },
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
