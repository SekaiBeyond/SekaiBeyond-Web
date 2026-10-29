export interface NavLink {
    id: string;
    href: string;
    labelEn: string;
    labelCn: string;
    /** Route used instead of scrolling to `href` once the target page is published. */
    publishedRoute?: string;
}

export const resolveNavHref = (link: NavLink, published: boolean): string =>
    published && link.publishedRoute ? link.publishedRoute : link.href;

/** A link's label, in the singular for Upcoming Events when there's only one. */
export const navLinkLabel = (link: NavLink, isEnglish: boolean, singleUpcoming: boolean): string =>
    link.id === 'upcoming' && singleUpcoming && isEnglish
        ? 'Upcoming Event'
        : (isEnglish ? link.labelEn : link.labelCn);

const SHARED_LINKS: NavLink[] = [
    {
        id: 'about',
        href: '#about',
        labelEn: 'About Us',
        labelCn: '关于我们',
    },
    {
        id: 'upcoming',
        href: '#upcoming',
        labelEn: 'Upcoming Events',
        labelCn: '活动预告',
    },
    {
        id: 'con',
        href: '#con',
        publishedRoute: '/con',
        labelEn: 'Sekai Beyond Con',
        labelCn: '彼世界动漫游戏展',
    },
    {
        id: 'events',
        href: '#events',
        labelEn: 'Past Events',
        labelCn: '往期活动',
    },
    {
        id: 'team',
        href: '#team',
        labelEn: 'Team',
        labelCn: '幕后团队',
    },
];

export const FOOTER_LINKS: NavLink[] = [
    ...SHARED_LINKS,
    {
        id: 'github',
        href: '',
        labelEn: 'GitHub',
        labelCn: 'GitHub',
    },
    {
        id: 'email',
        href: '',
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
