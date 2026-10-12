export interface NavLink {
    id: string;
    /** Blank for the footer's email and GitHub links, whose targets are site config. */
    href: string;
    labelEn: string;
    labelCn: string;
    /**
     * A route to open instead of scrolling to `href` once the page behind it is
     * published. `href` stays the fallback so visitors never land on a placeholder.
     */
    publishedRoute?: string;
}

/** The link a nav item should currently point at. */
export const resolveNavHref = (link: NavLink, published: boolean): string =>
    published && link.publishedRoute ? link.publishedRoute : link.href;

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
]

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
