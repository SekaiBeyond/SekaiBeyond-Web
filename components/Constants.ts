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
    {name: 'Buzzly 小布', role: 'President', roleCn: '社长', src: '~/../public/images/Officer_Avatar_Angel.jpg'},
    {name: 'Jason Chen', role: 'Secretary', roleCn: '秘书', src: '~/../public/images/Officer_Avatar_JasonChen.jpg'},
    {
        name: 'Ernin Meng',
        role: 'External Relations',
        roleCn: '对外关系',
        src: '~/../public/images/Officer_Avatar_ErninMeng.jpg'
    },
    {name: 'Alina', role: 'Art', roleCn: '美术', src: '~/../public/images/Officer_Avatar_AlinaYuan.jpg'},
    {name: 'DEMO', role: 'Art', roleCn: '美术', src: '~/../public/images/Officer_Avatar_EvaChen.jpg'},
    {
        name: 'Winter',
        role: 'Events Planning & Technical Advisor',
        roleCn: '活动策划 & 技术顾问',
        src: '~/../public/images/Officer_Avatar_WynterLin.jpg'
    },
    {name: 'Anne He', role: 'Social Media', roleCn: '社交媒体', src: '~/../public/images/Officer_Avatar_Anne.jpg'}
];