/**
 * Every piece of copy on the con page lives here, in both languages.
 *
 * Seven of these exports are also editable from the admin panel's Con Content tab,
 * which stores overrides in Firestore (`conContent/main`): CON, ROOMS, SCHEDULE,
 * GUESTS, VENDORS + VENDOR_CTA, TICKETS, and FAQ. What is written below stays the
 * shipped default — `app/lib/conContent.ts` overlays the stored value section by
 * section, so an empty or unreachable document falls back to this file rather
 * than to a blank page. Editing here still works; it sets what a visitor sees
 * before the fetch lands, and what they keep seeing for any section an admin has
 * never touched.
 *
 * The rest — HERO_VIDEO, NAV_LINKS, ABOUT_PARAGRAPHS, HIGHLIGHTS, VENUE_NOTES —
 * is code-only, because it is tied to files in public/ or to section anchors that
 * an admin cannot add. ROOM_ACCENTS is code-only for the same reason (each value
 * is a CSS class), but which rooms exist and which accent each wears is data.
 */

import { BILIBILI_VIDEO } from '~/constants';
import type { Localized } from '~/pages/con/i18n';

/** Page-level switches, kept apart from the copy they govern. */
export interface ConSettings {
    /**
     * When false, /con is visible to core-staff and the president only; everyone
     * else gets a short "coming soon" card. Defaults to true so the page does not
     * disappear the moment this field is introduced.
     */
    published: boolean
}

export const CON_SETTINGS: ConSettings = {
    published: true,
};

export interface ConVenue {
    name: Localized
    room: Localized
    address: string
    mapUrl: string
}

export interface ConEvent {
    edition: number
    name: Localized
    tagline: Localized
    intro: Localized
    /** Local time, no timezone suffix. */
    date: string
    endTime: string
    doorsOpen: Localized
    venue: ConVenue
    ticketUrl: string
}

export const CON: ConEvent = {
    edition: 2026,
    name: {en: 'Sekai Beyond Con', zh: '彼世界漫展'},
    tagline: {
        en: 'One day, one stage, every world you love.',
        zh: '一日一舞台，汇聚你所热爱的每一个世界。',
    },
    intro: {
        en: 'Anime, comics, games, and music — brought together by the Sekai Beyond community at the University of Washington. Stage performances, artist alley, cosplay, tabletop, and a whole lot of friends you have not met yet.',
        zh: '动漫、漫画、游戏与音乐——由华盛顿大学 Sekai Beyond 社区共同呈现。舞台演出、创作者市集、Cosplay、桌游，以及许多你还没遇见的朋友。',
    },

    /** PLACEHOLDER — confirm before launch. */
    date: '2026-11-14T11:00:00',
    endTime: '2026-11-14T20:00:00',
    doorsOpen: {en: 'Doors open 11:00 AM', zh: '11:00 开场'},

    venue: {
        name: {en: 'Husky Union Building (HUB)', zh: '华盛顿大学学生活动中心 (HUB)'},
        room: {en: 'HUB Ballroom', zh: 'HUB 宴会厅'},
        address: '4001 E Stevens Way NE, Seattle, WA 98195',
        mapUrl: 'https://maps.google.com/?q=Husky+Union+Building+University+of+Washington',
    },

    /** PLACEHOLDER — swap for the real ticketing link. */
    ticketUrl: 'https://huskylink.washington.edu/organization/sekaibeyond',
};

/**
 * The hero backdrop, in order of preference:
 *
 *   1. `loopMp4` / `loopWebm` — a short silent clip served from public/. This is
 *      the only option that actually loops, and it autoplays on phones too.
 *   2. The Bilibili embed below — plays once, desktop only. Bilibili's iframe has
 *      no loop parameter and is cross-origin, so we cannot restart it ourselves.
 *   3. `poster`, or a gradient if that is empty too.
 *
 * To turn on looping: export a 10–20s cut of the reel (silent, ~1080p, under a
 * few MB), drop it in public/, and set the paths here.
 */
export const HERO_VIDEO = {
    loopMp4: '',
    loopWebm: '',

    /** The featured reel, shared with the main site's video section. */
    aid: BILIBILI_VIDEO.aid,
    bvid: BILIBILI_VIDEO.bvid,
    cid: BILIBILI_VIDEO.cid,

    /** Still frame for reduced-motion visitors, and the clip's own poster while it buffers. */
    poster: '',
};

export interface NavLink {
    id: string
    label: Localized
}

export const NAV_LINKS: NavLink[] = [
    {id: 'about', label: {en: 'About', zh: '关于漫展'}},
    {id: 'schedule', label: {en: 'Schedule', zh: '活动日程'}},
    {id: 'guests', label: {en: 'Guests', zh: '嘉宾'}},
    {id: 'vendors', label: {en: 'Artist Alley', zh: '创作者市集'}},
    {id: 'tickets', label: {en: 'Tickets', zh: '门票'}},
    {id: 'venue', label: {en: 'Venue', zh: '场地'}},
    {id: 'faq', label: {en: 'FAQ', zh: '常见问题'}},
];

export const ABOUT_PARAGRAPHS: Localized[] = [
    {
        en: 'Sekai Beyond Con is our annual celebration of the worlds we grew up in — anime, comics, games, and the music that came with them. It started as a student-run afternoon of performances and has grown into a full day of stages, markets, and meetups open to everyone.',
        zh: '彼世界漫展是我们一年一度的庆典，献给陪我们长大的那些世界——动漫、漫画、游戏，以及与之相伴的音乐。它最初只是学生自办的一个演出下午，如今已成长为面向所有人的整日舞台、市集与聚会。',
    },
    {
        en: 'Everything you see is built by volunteers from the Sekai Beyond community: the stage crew, the artists in the alley, the cosplayers on the runway, and the students running the door. Come for the line-up, stay for the people.',
        zh: '你所看到的一切都由 Sekai Beyond 社区的志愿者共同搭建：舞台组、市集上的创作者、走秀的 Coser，以及在门口值班的同学。为节目而来，为伙伴留下。',
    },
];

export interface Highlight {
    icon: string
    label: Localized
    blurb: Localized
}

export const HIGHLIGHTS: Highlight[] = [
    {
        icon: '🎤',
        label: {en: 'Live Stage', zh: '现场舞台'},
        blurb: {
            en: 'Band sets, idol covers, and J-pop performances from student groups all afternoon.',
            zh: '学生乐队、偶像翻跳与 J-pop 演出，整个下午轮番登场。',
        },
    },
    {
        icon: '🎨',
        label: {en: 'Artist Alley', zh: '创作者市集'},
        blurb: {
            en: 'Prints, charms, and originals straight from the illustrators who made them.',
            zh: '海报、挂件与原创周边，直接来自绘师本人。',
        },
    },
    {
        icon: '👗',
        label: {en: 'Cosplay Runway', zh: 'Cosplay 走秀'},
        blurb: {
            en: 'Walk the runway solo or with your group — no judging panel, all encouragement.',
            zh: '个人或团体皆可上台走秀——没有评委压力，只有掌声。',
        },
    },
    {
        icon: '🎮',
        label: {en: 'Game Zone', zh: '游戏区'},
        blurb: {
            en: 'Rhythm games, fighters, and tabletop tables running free play all day.',
            zh: '音游、格斗与桌游区域全天开放自由体验。',
        },
    },
    {
        icon: '🃏',
        label: {en: 'Fan Exchange', zh: '同好交换'},
        blurb: {
            en: 'Trade badges, cards, and merch at the community swap corner.',
            zh: '在同好交换角落交换吧唧、卡牌与周边。',
        },
    },
    {
        icon: '📸',
        label: {en: 'Photo Wall', zh: '拍照墙'},
        blurb: {
            en: 'Themed backdrops and volunteer photographers for your best shot.',
            zh: '主题背景板与志愿摄影师，帮你拍下最好的一张。',
        },
    },
];

// Rooms + schedule — PLACEHOLDER; the real grid lives in conContent/main

/**
 * Chip colours a room can use. The palette is fixed in code because each value
 * is a CSS class (`sbc-room-chip--pink`); which room wears which colour is not.
 */
export const ROOM_ACCENTS = ['pink', 'violet', 'amber', 'sky', 'mint', 'slate'] as const;

export type RoomAccent = typeof ROOM_ACCENTS[number]

export interface Room {
    /** Stable slug referenced by `ScheduleItem.room`. */
    id: string
    name: Localized
    accent: RoomAccent
}

/**
 * Generic placeholder rooms, matching the placeholder programming below. The real
 * room list for a given year is admin data — this is only what a visitor sees
 * before the Firestore fetch lands, or if it fails.
 */
export const ROOMS: Room[] = [
    {id: 'stage', name: {en: 'Main Stage', zh: '主舞台'}, accent: 'pink'},
    {id: 'panel', name: {en: 'Panel Room', zh: '座谈厅'}, accent: 'violet'},
    {id: 'workshop', name: {en: 'Workshop Room', zh: '工作坊教室'}, accent: 'amber'},
    {id: 'open', name: {en: 'Open Floor', zh: '自由活动'}, accent: 'sky'},
];

export interface ScheduleItem {
    /**
     * Omitted together when the slot is announced but unscheduled — the page
     * shows "TBA" in the time column rather than hiding the item.
     */
    start?: string
    end?: string
    /** A `Room.id`. An id with no matching room renders without a chip. */
    room: string
    title: Localized
    location?: Localized
    detail?: Localized
}

export interface ScheduleBlock {
    id: string
    label: Localized
    items: ScheduleItem[]
}

export const SCHEDULE: ScheduleBlock[] = [
    {
        id: 'morning',
        label: {en: 'Morning', zh: '上午'},
        items: [
            {
                start: '11:00',
                end: '11:30',
                room: 'open',
                title: {en: 'Doors Open & Registration', zh: '开场与签到'},
                location: {en: 'HUB Lobby', zh: 'HUB 大厅'},
                detail: {
                    en: 'Pick up your badge, grab a map, and find the artist alley before it gets busy.',
                    zh: '领取吧唧与地图，趁人少先逛逛创作者市集。',
                },
            },
            {
                start: '11:30',
                end: '12:00',
                room: 'stage',
                title: {en: 'Opening Ceremony', zh: '开幕式'},
                location: {en: 'Main Stage', zh: '主舞台'},
            },
            {
                start: '12:00',
                end: '13:00',
                room: 'stage',
                title: {en: 'Student Band Showcase', zh: '学生乐队专场'},
                location: {en: 'Main Stage', zh: '主舞台'},
            },
        ],
    },
    {
        id: 'afternoon',
        label: {en: 'Afternoon', zh: '下午'},
        items: [
            {
                start: '13:00',
                end: '14:00',
                room: 'panel',
                title: {en: 'Making It in Anime Illustration', zh: '动漫插画创作分享'},
                location: {en: 'Panel Room', zh: '座谈厅'},
                detail: {
                    en: 'Guest illustrators talk commissions, process, and building an audience.',
                    zh: '嘉宾绘师分享约稿、创作流程与积累观众的经验。',
                },
            },
            {
                start: '14:00',
                end: '15:30',
                room: 'stage',
                title: {en: 'Cosplay Runway', zh: 'Cosplay 走秀'},
                location: {en: 'Main Stage', zh: '主舞台'},
            },
            {
                start: '15:30',
                end: '16:30',
                room: 'workshop',
                title: {en: 'Prop Crafting 101', zh: '道具制作入门'},
                location: {en: 'Workshop Room', zh: '工作坊教室'},
                detail: {
                    en: 'Hands-on foam and worbla basics. Materials provided, first come first served.',
                    zh: '现场动手体验 EVA 与热塑板基础，材料现场提供，先到先得。',
                },
            },
            {
                start: '16:30',
                end: '17:30',
                room: 'open',
                title: {en: 'Rhythm Game Tournament', zh: '音游比赛'},
                location: {en: 'Game Zone', zh: '游戏区'},
            },
        ],
    },
    {
        id: 'evening',
        label: {en: 'Evening', zh: '晚间'},
        items: [
            {
                start: '17:30',
                end: '19:00',
                room: 'stage',
                title: {en: 'Idol & J-pop Night', zh: '偶像与 J-pop 之夜'},
                location: {en: 'Main Stage', zh: '主舞台'},
            },
            {
                start: '19:00',
                end: '19:30',
                room: 'stage',
                title: {en: 'Closing Ceremony', zh: '闭幕式'},
                location: {en: 'Main Stage', zh: '主舞台'},
            },
            {
                start: '19:30',
                end: '20:00',
                room: 'open',
                title: {en: 'Group Photo & Teardown', zh: '大合照与撤场'},
                location: {en: 'HUB Lobby', zh: 'HUB 大厅'},
            },
        ],
    },
];

// Guests — PLACEHOLDER line-up

export interface Guest {
    name: string
    role: Localized
    blurb: Localized
    /** Path under public/, e.g. '/guests/name.webp'. Falls back to an initial badge. */
    avatar?: string
    link?: string
}

export const GUESTS: Guest[] = [
    {
        name: 'Guest Announcement #1',
        role: {en: 'Illustrator', zh: '插画师'},
        blurb: {
            en: 'Line-up announcements start rolling out closer to the event — follow us to hear first.',
            zh: '嘉宾阵容将在临近活动时陆续公布，关注我们第一时间获知。',
        },
    },
    {
        name: 'Guest Announcement #2',
        role: {en: 'Cosplayer', zh: 'Coser'},
        blurb: {
            en: 'Runway guest and photo-wall host for the afternoon block.',
            zh: '下午场走秀嘉宾与拍照墙主持。',
        },
    },
    {
        name: 'Guest Announcement #3',
        role: {en: 'Performer', zh: '表演嘉宾'},
        blurb: {
            en: 'Headlining the evening stage. Set list to be revealed on the day.',
            zh: '晚间舞台压轴登场，曲目当天揭晓。',
        },
    },
];

// Artist alley / vendors — PLACEHOLDER

export interface Vendor {
    name: string
    kind: Localized
    handle?: string
    link?: string
}

export const VENDORS: Vendor[] = [
    {name: 'Table A1 — TBA', kind: {en: 'Prints & Stickers', zh: '海报与贴纸'}},
    {name: 'Table A2 — TBA', kind: {en: 'Acrylic Charms', zh: '亚克力挂件'}},
    {name: 'Table A3 — TBA', kind: {en: 'Original Comics', zh: '原创漫画'}},
    {name: 'Table B1 — TBA', kind: {en: 'Handmade Props', zh: '手作道具'}},
    {name: 'Table B2 — TBA', kind: {en: 'Plush & Fibre Art', zh: '毛绒与织物'}},
    {name: 'Table B3 — TBA', kind: {en: 'Zines & Art Books', zh: '画册与刊物'}},
];

export interface VendorCta {
    heading: Localized
    body: Localized
    label: Localized
}

export const VENDOR_CTA: VendorCta = {
    heading: {en: 'Want a table?', zh: '想要摊位？'},
    body: {
        en: 'Artist alley applications open a few weeks before the con. Registered members get first pick of tables.',
        zh: '创作者市集摊位申请将于展前数周开放，注册会员可优先选位。',
    },
    label: {en: 'Ask about tabling', zh: '咨询摊位'},
};

// Tickets — PLACEHOLDER pricing

export interface TicketTier {
    id: string
    name: Localized
    price: Localized
    note: Localized
    perks: Localized[]
    featured?: boolean
}

export const TICKETS: TicketTier[] = [
    {
        id: 'student',
        name: {en: 'UW Student', zh: 'UW 在校生'},
        price: {en: 'Free', zh: '免费'},
        note: {en: 'With a valid Husky Card at the door', zh: '凭有效 Husky Card 现场入场'},
        perks: [
            {en: 'Full-day access to every stage and room', zh: '全天通行所有舞台与场地'},
            {en: 'Event badge while supplies last', zh: '活动吧唧，送完为止'},
            {en: 'Game zone free play', zh: '游戏区自由体验'},
        ],
    },
    {
        id: 'general',
        name: {en: 'General Admission', zh: '普通票'},
        price: {en: '$10', zh: '$10'},
        note: {en: 'Cheaper in advance than at the door', zh: '预售价低于现场购票'},
        perks: [
            {en: 'Full-day access to every stage and room', zh: '全天通行所有舞台与场地'},
            {en: 'Event badge while supplies last', zh: '活动吧唧，送完为止'},
            {en: 'Game zone free play', zh: '游戏区自由体验'},
            {en: 'Priority entry line', zh: '优先入场通道'},
        ],
        featured: true,
    },
    {
        id: 'supporter',
        name: {en: 'Supporter', zh: '支持者票'},
        price: {en: '$25', zh: '$25'},
        note: {en: 'Helps fund the stage and student artists', zh: '用于支持舞台与学生创作者'},
        perks: [
            {en: 'Everything in General Admission', zh: '包含普通票所有内容'},
            {en: 'Limited-run con merch', zh: '限量漫展周边'},
            {en: 'Reserved seating for the evening stage', zh: '晚间舞台预留座位'},
            {en: 'Name on the thank-you wall', zh: '鸣谢墙署名'},
        ],
    },
];

export interface VenueNote {
    icon: string
    label: Localized
    body: Localized
}

export const VENUE_NOTES: VenueNote[] = [
    {
        icon: '🚈',
        label: {en: 'Light Rail', zh: '轻轨'},
        body: {
            en: 'Take the 1 Line to U District Station, then walk about 10 minutes south into campus.',
            zh: '乘坐 1 号线至 U District 站，向南步行约 10 分钟进入校园。',
        },
    },
    {
        icon: '🚌',
        label: {en: 'Bus', zh: '公交'},
        body: {
            en: 'Routes along Stevens Way and NE Campus Parkway stop within a block of the HUB.',
            zh: 'Stevens Way 与 NE Campus Parkway 沿线公交站距 HUB 仅一个街区。',
        },
    },
    {
        icon: '🅿️',
        label: {en: 'Parking', zh: '停车'},
        body: {
            en: 'Central Plaza Garage is the closest paid garage. Weekend rates are lower — arrive early.',
            zh: 'Central Plaza 停车楼为最近的收费车库，周末价格更低，建议早到。',
        },
    },
    {
        icon: '♿',
        label: {en: 'Accessibility', zh: '无障碍'},
        body: {
            en: 'Step-free entry, elevators to every room, and reserved seating near the stage. Email us for specific needs.',
            zh: '无台阶入口、各层电梯直达，舞台附近设预留座位。有特殊需求请邮件联系我们。',
        },
    },
];

export interface FaqEntry {
    q: Localized
    a: Localized
}

export const FAQ: FaqEntry[] = [
    {
        q: {en: 'Do I need to be a UW student to come?', zh: '一定要是 UW 学生才能参加吗？'},
        a: {
            en: 'No. Sekai Beyond Con is open to the public — students, alumni, families, and anyone visiting Seattle for the weekend.',
            zh: '不需要。彼世界漫展面向公众开放——在校生、校友、家人，以及任何周末来到西雅图的朋友都欢迎。',
        },
    },
    {
        q: {en: 'Can I cosplay? Are there prop rules?', zh: '可以 Cosplay 吗？道具有什么规定？'},
        a: {
            en: 'Please do. Props must be clearly non-functional, blunt, and short enough to carry safely indoors. No live steel, no realistic firearms, no open flame.',
            zh: '非常欢迎。道具需明显不具功能性、无锋利边缘，且长度便于在室内安全携带。禁止真刃、仿真枪械与明火。',
        },
    },
    {
        q: {en: 'Is there a place to change into costume?', zh: '现场有换装的地方吗？'},
        a: {
            en: 'Yes — a marked changing room is available near registration for the whole day. It is not a storage room, so plan to carry your bag or use a locker.',
            zh: '有的，签到处附近设有标示清晰的更衣室，全天开放。更衣室不提供寄存，请自行携带背包或使用储物柜。',
        },
    },
    {
        q: {en: 'Is food available?', zh: '现场有餐饮吗？'},
        a: {
            en: 'HUB dining is open during the event, and campus has plenty of options nearby. Outside food is fine in the lobby but not in the stage hall.',
            zh: 'HUB 内餐饮在活动期间正常营业，校园周边也有很多选择。外带食物可在大厅食用，但请勿带入舞台厅。',
        },
    },
    {
        q: {en: 'How do I volunteer?', zh: '如何成为志愿者？'},
        a: {
            en: 'Volunteer sign-ups run through our Discord and HuskyLink in the weeks before the con. Stage crew, door, and photo team are always looking for help.',
            zh: '志愿者报名将在展前数周通过 Discord 与 HuskyLink 开放。舞台组、门口接待与摄影组长期需要帮手。',
        },
    },
    {
        q: {en: 'What is the photo and recording policy?', zh: '拍照与录像有什么规定？'},
        a: {
            en: 'Ask before photographing cosplayers, and respect a no. The event is documented by our media team, and footage may appear on our channels.',
            zh: '拍摄 Coser 前请先征得同意，被拒绝时请予尊重。活动将由我们的媒体组记录，素材可能出现在我们的社交平台上。',
        },
    },
];
