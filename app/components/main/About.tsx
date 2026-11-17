import { type KeyboardEvent, useState } from "react";
import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useLanguage } from "~/components/LanguageContextProvider";
import { SOCIAL_LINK_NAMES, type SocialLinks, useSiteConfig } from "~/lib/siteConfig";

const SOCIALS = [
    {key: 'discord', Icon: SiDiscord, tagEn: 'Chat & Hangout', tagZh: '群聊与开黑'},
    {key: 'instagram', Icon: SiInstagram, tagEn: 'Photos & Reels', tagZh: '返图与动态'},
    {key: 'bilibili', Icon: SiBilibili, tagEn: 'Stage & Videos', tagZh: '舞台与视频'},
    {key: 'xiaohongshu', Icon: SiXiaohongshu, tagEn: 'Event Notes', tagZh: '活动笔记'},
    {key: 'linkedin', Icon: FaLinkedin, tagEn: 'Network', tagZh: '社团主页'},
] as const;

const hasFollowLinks = (links: SocialLinks): boolean => SOCIALS.some(({key}) => links[key]);

interface Realm {
    id: string;
    icon: string;
    labelEn: string;
    labelZh: string;
    badgeEn: string;
    badgeZh: string;
    titleEn: string;
    titleZh: string;
    bodyEn: string[];
    bodyZh: string[];
}

const REALMS: Realm[] = [
    {
        id: 'story',
        icon: '🌸',
        labelEn: 'Our Story',
        labelZh: '社团简介',
        badgeEn: 'Dimension 00 · The Portal',
        badgeZh: '第零次元 · 平行时空入口',
        titleEn: 'A space for students who love anime to freely explore and become any version of themselves',
        titleZh: '专为热爱二次元文化的学生们打造自由的探险之地',
        bodyEn: [
            "Whether you're a passionate cosplayer, a creative artist, or an energetic dancer, Sekai Beyond offers a short escape from the everyday world. From manga and anime to films and games, we enjoy it all.",
            "While we love recreating and cosplaying our favorite series, we also encourage you to create brand-new stories—designing new IPs, crafting original characters, or making games together. The portal to a multiverse can appear in every corner of campus!",
        ],
        bodyZh: [
            "在彼世界中，我们支持你成为任何形式的自己——无论是喜爱角色扮演的 Coser、富有创意的画师，还是充满活力的舞者。漫画、动漫、电影与游戏都是我们热爱的领域。",
            "在复刻与还原经典作品的同时，我们更鼓励你用天马行空的想象力创造全新的故事：设计原创 IP、绘制 OC，或是合力开发一款游戏。通往平行时空的传送门会出现在校园的每一个角落，我们在彼世界等你！",
        ],
    },
    {
        id: 'events',
        icon: '🎉',
        labelEn: 'Campus Events',
        labelZh: '校园活动',
        badgeEn: 'Dimension 01 · Campus Life',
        badgeZh: '第一次元 · 校园日常与盛会',
        titleEn: 'From cozy game nights and cosplay meetups to our annual convention',
        titleZh: '从游戏之夜、Cosplay 聚会到一年一度的校园漫展',
        bodyEn: [
            "Throughout the school year, we host anime screenings, tabletop and console game nights, creative workshops, cosplay gatherings, and pop-up Maid Cafes right here on campus.",
            "Every event is a chance to hang out, meet fellow fans, and celebrate the things we love—culminating in our annual Sekai Beyond Con!",
        ],
        bodyZh: [
            "在整个学年里，我们会在校园内举办动漫放映会、桌游与主机游戏夜、创作工作坊、Cosplay 交流会以及限定女仆咖啡厅等丰富多彩的活动。",
            "每一次聚会都是结识同好、分享热爱的契机，并在一年一度的彼世界动漫游戏展（Sekai Beyond Con）迎来高潮！",
        ],
    },
    {
        id: 'gamedev',
        icon: '🎮',
        labelEn: 'Game Dev',
        labelZh: '游戏开发',
        badgeEn: 'Dimension 02 · Creation Lab',
        badgeZh: '第二次元 · 创作工坊',
        titleEn: 'Crafting original worlds, characters, and indie games together',
        titleZh: '从零开始，合力打造原创 IP、角色与独立游戏',
        bodyEn: [
            "Let your imagination run wild! Our creators team up across art, storywriting, music, and code to design original characters (OCs), build new IPs, and develop games from the ground up.",
            "Whether you're a seasoned developer, a digital illustrator, or writing your very first visual novel script, you'll find collaborators ready to bring new worlds to life.",
        ],
        bodyZh: [
            "尽管大胆提出奇思妙想吧！在这里，画师、剧本、音乐与程序跨界组队，从零设计原创角色（OC）、构建世界观，并亲手制作属于我们自己的独立游戏。",
            "无论你是经验丰富的开发者、原画师，还是第一次尝试写视觉小说剧本的新手，都能在这里找到志同道合的伙伴，把脑海中的幻想变成现实。",
        ],
    },
    {
        id: 'idol',
        icon: '🎤',
        labelEn: 'Idol Performance',
        labelZh: '地偶表演',
        badgeEn: 'Dimension 03 · Center Stage',
        badgeZh: '第三次元 · 舞台闪耀',
        titleEn: 'From Red Square random dance play to live house stages',
        titleZh: '从 Red Square 随机宅舞到 Live House 乐队与地偶舞台',
        bodyEn: [
            "You might find yourself watching a Love Live! dance cover, cheering with glowsticks at a J-pop live house band performance, or jumping into a spontaneous random dance in Red Square.",
            "Our dancers and musicians rehearse together all year round to light up campus showcases and Sekai Beyond Con!",
        ],
        bodyZh: [
            "你可能会在 Red Square 偶遇并加入我们的随机宅舞，在校园里挥舞荧光棒欣赏 Live House 乐队演出，或是观看元气满满的 Love Live! 与地下偶像宅舞舞台。",
            "我们的舞见与乐手们全年排练，只为在校园演出与彼世界漫展的舞台上绽放光芒！",
        ],
    },
];

const MIKA_TRAITS = [
    {
        icon: '🦋',
        labelEn: 'MBTI',
        labelZh: 'MBTI',
        valueEn: 'INFP — The Dreamer',
        valueZh: 'INFP（小蝴蝶捏~）',
    },
    {
        icon: '🐱',
        labelEn: 'Companion',
        labelZh: '动物偏好',
        valueEn: 'Neko! Loves her fluffy white odd-eyed cat, Mino.',
        valueZh: 'Neko！最爱自家的白色长毛异瞳猫“米诺”。',
    },
    {
        icon: '🍡',
        labelEn: 'Favorite Sweet',
        labelZh: '食物偏好',
        valueEn: 'Matcha daifuku (though icy food upsets her tummy).',
        valueZh: '抹茶大福等甜食（但胃对太冰的食物不太耐受）。',
    },
    {
        icon: '🎮',
        labelEn: 'Ideal Hangout',
        labelZh: '交友偏好',
        valueEn: 'Shy at first, but loves Switch games & anime marathons at home!',
        valueZh: '慢热社恐，最喜欢和朋友窝在家里打 Switch 或连看动漫！',
    },
] as const;

export const About = () => {
    const [activeRealmId, setActiveRealmId] = useState<string>('story');
    const [isFlipped, setIsFlipped] = useState(false);
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();

    const activeRealm = REALMS.find(r => r.id === activeRealmId) ?? REALMS[0];

    const onRealmKeyDown = (e: KeyboardEvent) => {
        const idx = REALMS.findIndex(r => r.id === activeRealm.id);
        const nextIdx = e.key === 'ArrowRight'
            ? (idx + 1) % REALMS.length
            : e.key === 'ArrowLeft'
                ? (idx - 1 + REALMS.length) % REALMS.length
                : -1;
        if (nextIdx === -1) return;
        e.preventDefault();
        const next = REALMS[nextIdx];
        setActiveRealmId(next.id);
        document.getElementById(`about-realm-tab-${next.id}`)?.focus();
    };

    return (
        <section id="about" className="about-section section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "About Sekai Beyond" : "关于彼世界动漫社"}</h2>
                <p className="section-subtitle">
                    {isEnglish
                        ? "The intersection of dream and reality is where the multiverse breaks the dimensional wall."
                        : "现实与幻想的交汇处，是打破次元壁的平行时空。"}
                </p>
            </div>

            <div className="about-content">
                <div className="about-explorer">
                    <div
                        className="about-realm-tabs"
                        role="tablist"
                        aria-label={isEnglish ? "Explore Sekai Beyond realms" : "探索彼世界领域"}
                        onKeyDown={onRealmKeyDown}
                    >
                        {REALMS.map(realm => {
                            const selected = realm.id === activeRealm.id;
                            return (
                                <button
                                    key={realm.id}
                                    id={`about-realm-tab-${realm.id}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    aria-controls="about-realm-panel"
                                    tabIndex={selected ? 0 : -1}
                                    className="about-realm-tab"
                                    onClick={() => setActiveRealmId(realm.id)}
                                >
                                    <span className="about-realm-tab-icon" aria-hidden="true">{realm.icon}</span>
                                    <span>
                                        {isEnglish ? realm.labelEn : realm.labelZh}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div
                        id="about-realm-panel"
                        key={activeRealm.id}
                        role="tabpanel"
                        aria-labelledby={`about-realm-tab-${activeRealm.id}`}
                        className="about-realm-stage"
                    >
                        <div className="about-realm-watermark" aria-hidden="true">{activeRealm.icon}</div>
                        <span className="about-realm-badge">
                            {isEnglish ? activeRealm.badgeEn : activeRealm.badgeZh}
                        </span>
                        <h3 className="about-realm-title">
                            {isEnglish ? activeRealm.titleEn : activeRealm.titleZh}
                        </h3>
                        <div className="about-prose">
                            {(isEnglish ? activeRealm.bodyEn : activeRealm.bodyZh).map((para, i) => (
                                <p key={i}>{para}</p>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="about-image">
                    <div className={`mika-dossier${isFlipped ? ' is-flipped' : ''}`}>
                        <div className="mika-dossier-inner">
                            <div className="mika-face mika-face--front" aria-hidden={isFlipped}>
                                <button
                                    type="button"
                                    className="mika-card-btn"
                                    onClick={() => setIsFlipped(true)}
                                    tabIndex={isFlipped ? -1 : 0}
                                    aria-label={isEnglish
                                        ? "Flip card to read Mika's character profile"
                                        : "翻转卡片查看吉祥物米卡的人设档案"}
                                >
                                    <div className="mika-polaroid-art">
                                        <span className="mika-id-pill">
                                            {isEnglish ? "✨ Mascot ID · #001" : "✨ 吉祥物档案 · #001"}
                                        </span>
                                        <img
                                            src="/mika.webp"
                                            alt="Mika, Sekai Beyond Mascot"
                                            className="about-main-image"
                                        />
                                    </div>
                                    <div className="mika-polaroid-footer">
                                        <div className="mika-polaroid-meta">
                                            <span className="mika-polaroid-name">
                                                {isEnglish ? "Mika" : "米卡"}
                                            </span>
                                            <span className="mika-polaroid-quote">
                                                {isEnglish
                                                    ? "“Tap to flip my character card!”"
                                                    : "“点击翻转，查看我的人设卡吧！”"}
                                            </span>
                                        </div>
                                        <span className="mika-flip-pill" aria-hidden="true">
                                            {isEnglish ? "Flip ↻" : "翻转 ↻"}
                                        </span>
                                    </div>
                                </button>
                            </div>

                            <div className="mika-face mika-face--back" aria-hidden={!isFlipped}>
                                <div className="mika-sheet-top">
                                    <img
                                        src="/mika.webp"
                                        alt=""
                                        aria-hidden="true"
                                        className="mika-sheet-avatar"
                                    />
                                    <div className="mika-sheet-heading">
                                        <span className="mika-sheet-kicker">
                                            {isEnglish ? "Character File" : "人设档案"}
                                        </span>
                                        <h4 className="mika-sheet-name">
                                            {isEnglish ? "Mika" : "米卡"}
                                        </h4>
                                    </div>
                                    <button
                                        type="button"
                                        className="mika-flip-back-btn"
                                        onClick={() => setIsFlipped(false)}
                                        tabIndex={isFlipped ? 0 : -1}
                                        aria-label={isEnglish ? "Flip back to photo" : "翻回照片正面"}
                                    >
                                        {isEnglish ? "↺ Photo" : "↺ 立绘"}
                                    </button>
                                </div>

                                <p className="mika-sheet-bio">
                                    {isEnglish
                                        ? "A J-Pop dance enthusiast who’d rather spend a cozy night in than hit a big party. Because of her cute jellyfish-like haircut, everyone lovingly calls her “Jelly” ≡:). Super relatable—often cringing at past memories when alone 😅—and stays in shape through dancing and skipping sleepy carbs!"
                                        : "热爱跳宅舞的微社恐宅女，比起热闹派对更享受独处时光。因为发型是水母头，大家喜欢叫她“小水母”(:≡。偶尔会在四下无人时回想起往事尴尬到扣地（），平时靠跳宅舞和少吃容易犯困的碳水意外保持着好身材！"}
                                </p>

                                <ul className="mika-sheet-traits">
                                    {MIKA_TRAITS.map(trait => (
                                        <li key={trait.labelEn} className="mika-sheet-trait">
                                            <span className="mika-sheet-trait-icon" aria-hidden="true">
                                                {trait.icon}
                                            </span>
                                            <div className="mika-sheet-trait-text">
                                                <span className="mika-sheet-trait-label">
                                                    {isEnglish ? trait.labelEn : trait.labelZh}
                                                </span>
                                                <span className="mika-sheet-trait-val">
                                                    {isEnglish ? trait.valueEn : trait.valueZh}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {hasFollowLinks(config.socialLinks) && (
                <div className="about-follow">
                    <div className="about-follow-header">
                        <div className="about-follow-heading-group">
                            <span className="about-follow-kicker">
                                {isEnglish ? "Warp Channels" : "次元传送门"}
                            </span>
                            <h3 className="about-follow-title">
                                {isEnglish ? "Follow Us Across the Sekai" : "关注我们的社交媒体"}
                            </h3>
                        </div>
                        <p className="about-follow-subtitle">
                            {isEnglish
                                ? "Hop into our Discord or follow our socials for event drops, photos, and stage recaps."
                                : "加入 Discord 或关注各大平台官号，获取最新活动预告、返图与舞台回顾。"}
                        </p>
                    </div>
                    <div className="social-links-grid">
                        {SOCIALS.filter(({key}) => config.socialLinks[key]).map(({key, Icon, tagEn, tagZh}) => (
                            <a
                                key={key}
                                className="social-card"
                                data-platform={key}
                                href={config.socialLinks[key]}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <span className="social-icon-wrap" aria-hidden="true">
                                    <Icon className="social-icon"/>
                                </span>
                                <span className="social-meta">
                                    <span className="social-name">
                                        {isEnglish ? SOCIAL_LINK_NAMES[key].en : SOCIAL_LINK_NAMES[key].zh}
                                    </span>
                                    <span className="social-tag">
                                        {isEnglish ? tagEn : tagZh}
                                    </span>
                                </span>
                                <span className="social-arrow" aria-hidden="true">↗</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
};
