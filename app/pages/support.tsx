import type { IconType } from 'react-icons';
import { Link } from 'react-router';
import { FaEnvelope, FaExternalLinkAlt, FaPhoneAlt, FaUsers } from 'react-icons/fa';
import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from 'react-icons/si';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { GoToTop } from '~/components/GoToTop';
import { SOCIAL_LINK_NAMES, useSiteConfig } from '~/lib/siteConfig';

type Bilingual = {en: string; zh: string};

interface Action {
    kind: 'phone' | 'email' | 'link';
    href: string;
    /** A plain string reads the same in both languages: a number, an address, a name. */
    label: Bilingual | string;
}

interface Resource {
    id: string;
    name: Bilingual;
    description: Bilingual;
    /** When and for whom it's available, where that isn't anyone at any time. */
    availability?: Bilingual;
    actions: Action[];
}

const ACTION_ICONS: Record<Action['kind'], IconType> = {
    phone: FaPhoneAlt,
    email: FaEnvelope,
    link: FaExternalLinkAlt,
};

const SAFECAMPUS_PHONE: Action = {kind: 'phone', href: 'tel:+12066857233', label: 'SafeCampus · 206-685-7233'};

const MAKE_A_REPORT: Action = {
    kind: 'link',
    href: 'https://www.washington.edu/civilrights/making-a-report/make-a-report/',
    label: {en: 'Make a report to UW', zh: '向 UW 提交举报'},
};

/**
 * UW's own services, which this page sends people to instead of explaining the
 * process itself. Every name, number, address and claim here is taken from the
 * linked UW page, so re-check them there before changing anything, and update
 * `CHECKED` below when you do.
 */
const UW_RESOURCES: Resource[] = [
    {
        id: 'guide',
        name: {en: 'UW Sexual Assault Resources', zh: 'UW 性侵害援助资源（Sexual Assault Resources）'},
        description: {
            en: "UW's own guide to everything below, covering support, medical care and reporting in one place. Start here if you're not sure what you need.",
            zh: 'UW 官方的一站式指南，涵盖下面提到的支持、医疗和举报途径。如果不确定自己需要什么，可以从这里开始。',
        },
        actions: [{
            kind: 'link',
            href: 'https://www.washington.edu/sexualassault/',
            label: {en: "Open UW's guide", zh: '查看 UW 指南'},
        }],
    },
    {
        id: 'advocates',
        name: {en: 'Confidential Advocates', zh: '保密倡导员（Confidential Advocates）'},
        description: {
            en: "Talk privately with a trained advocate about what happened and what you'd like to do next. It's free, advocates don't report to the University, and meeting with one doesn't start an investigation or a report.",
            zh: '与受过专业训练的倡导员私下聊聊发生了什么，以及你接下来想怎么做。服务免费；倡导员不会向学校上报，与他们见面也不会启动任何调查或举报程序。',
        },
        availability: {
            en: 'Weekdays during business hours · for UW Seattle students',
            zh: '工作日办公时间 · 面向 UW 西雅图校区学生',
        },
        actions: [
            {kind: 'email', href: 'mailto:lwadvoc@uw.edu', label: 'lwadvoc@uw.edu'},
            {
                kind: 'link',
                href: 'https://wellbeing.uw.edu/livewell/survivor-support-advocacy/',
                label: {en: 'Book a time or learn more', zh: '预约或了解更多'},
            },
        ],
    },
    {
        id: 'safecampus',
        name: {en: 'SafeCampus', zh: 'SafeCampus'},
        description: {
            en: "UW's line for safety concerns, whether they're about you or about someone else. A specialist will listen and walk you through your options, and you can stay anonymous.",
            zh: 'UW 的安全求助热线，无论是为自己还是为他人担心都可以联系。工作人员会倾听你的情况，并帮你了解有哪些选择。你可以匿名。',
        },
        availability: {
            en: 'Monday to Friday, 8 am to 5 pm, except UW holidays',
            zh: '周一至周五上午 8 点至下午 5 点（UW 假日除外）',
        },
        actions: [
            SAFECAMPUS_PHONE,
            {
                kind: 'link',
                href: 'https://www.washington.edu/safecampus/sexual-assault/',
                label: {en: 'About SafeCampus', zh: '了解 SafeCampus'},
            },
        ],
    },
    {
        id: 'report',
        name: {en: 'Civil Rights & Title IX Report', zh: '民权与 Title IX 举报（Civil Rights & Title IX Report）'},
        description: {
            en: "The way to tell the University what happened. You can report something you experienced, saw or learned about, and in many cases you can stay anonymous. A report doesn't automatically start an investigation: if you leave your contact details, the Civil Rights Compliance Office gets in touch to offer support and explain your options.",
            zh: '向学校说明情况的正式渠道。无论是亲身经历、亲眼所见还是事后得知的事情都可以举报，很多情况下也可以匿名。举报不会自动启动调查；如果你留下联系方式，民权合规办公室（Civil Rights Compliance Office）会联系你，提供支持并说明你有哪些选择。',
        },
        actions: [
            MAKE_A_REPORT,
            {kind: 'phone', href: 'tel:+12062217932', label: '206-221-7932'},
        ],
    },
    {
        id: 'after-hours',
        name: {en: 'Outside office hours', zh: '非办公时间'},
        description: {
            en: "UW's offices are open on weekdays. These local lines answer day and night.",
            zh: 'UW 的办公室只在工作日开放。以下本地热线全天 24 小时接听。',
        },
        actions: [
            {
                kind: 'phone',
                href: 'tel:+18889986423',
                label: 'King County Sexual Assault Resource Center · 1-888-998-6423',
            },
            {
                kind: 'phone',
                href: 'tel:+12067441600',
                label: 'Harborview Abuse & Trauma Center · 206-744-1600',
            },
            {
                kind: 'link',
                href: 'https://www.washington.edu/safecampus/after-hours-resources/',
                label: {en: "UW's 24/7 resource list", zh: 'UW 的 24 小时资源列表'},
            },
        ],
    },
];

/** When the details in `UW_RESOURCES` were last checked against UW's pages. */
const CHECKED: Bilingual = {en: 'November 2026', zh: '2026 年 11 月'};

/** The club accounts that take direct messages. */
const CLUB_SOCIALS = [
    {key: 'discord', Icon: SiDiscord},
    {key: 'instagram', Icon: SiInstagram},
    {key: 'xiaohongshu', Icon: SiXiaohongshu},
    {key: 'bilibili', Icon: SiBilibili},
] as const;

export const SupportPage = () => {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();
    const t = (value: Bilingual | string): string =>
        typeof value === 'string' ? value : (isEnglish ? value.en : value.zh);

    const renderAction = (action: Action) => {
        const Icon = ACTION_ICONS[action.kind];
        return (
            <a
                key={action.href}
                className="support-action"
                href={action.href}
                {...(action.kind === 'link' ? {target: '_blank', rel: 'noopener noreferrer'} : {})}
            >
                <Icon aria-hidden="true"/>
                {t(action.label)}
            </a>
        );
    };

    return (
        <>
            <PageNav title={isEnglish ? 'Support' : '求助'} account={false}/>
            <div className="policy-page">
                <main className="policy-container support-container">
                    <h1 className="support-title">
                        {isEnglish ? 'Sexual Assault & Harassment Support' : '性侵害与性骚扰求助'}
                    </h1>
                    <p className="support-lead">
                        {isEnglish
                            ? "If you've experienced sexual assault, sexual harassment, relationship violence or stalking, or you're worried about someone who has, you are not alone and it is not your fault. Sekai Beyond is a student club, so we want you to have the professional support the University of Washington offers. This page shows you who to contact there, and how to reach us."
                            : '如果你经历了性侵害、性骚扰、亲密关系暴力或跟踪骚扰，或者担心身边的人有这样的遭遇，你并不孤单，这也不是你的错。彼世界是一个学生社团，我们希望你能获得华盛顿大学（UW）提供的专业支持。这个页面会告诉你在学校可以联系谁，以及如何找到我们。'}
                    </p>

                    <div className="support-emergency">
                        <span>
                            {isEnglish
                                ? 'In immediate danger, or need emergency medical care?'
                                : '有紧急危险，或需要紧急医疗救助？'}
                        </span>
                        <a className="support-emergency-call" href="tel:911">
                            <FaPhoneAlt aria-hidden="true"/>
                            {isEnglish ? 'Call 911' : '拨打 911'}
                        </a>
                    </div>

                    <section className="support-section" aria-labelledby="support-uw">
                        <h2 id="support-uw">{isEnglish ? 'Start with UW' : '先联系学校'}</h2>
                        <ul className="support-resources">
                            {UW_RESOURCES.map(resource => (
                                <li key={resource.id} className="support-resource">
                                    <h3>{t(resource.name)}</h3>
                                    <p>{t(resource.description)}</p>
                                    {resource.availability && (
                                        <p className="support-resource-availability">{t(resource.availability)}</p>
                                    )}
                                    <div className="support-actions">
                                        {resource.actions.map(renderAction)}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="support-section" aria-labelledby="support-club">
                        <h2 id="support-club">
                            {isEnglish ? 'If another club member is involved' : '如果涉及其他社团成员'}
                        </h2>
                        <p>
                            {isEnglish
                                ? "If the person who harmed you is a Sekai Beyond member, we still encourage you to reach out to UW first: the University can offer support and protections that a student club can't."
                                : '如果伤害你的人是彼世界的成员，我们仍然建议你先联系学校：学校能提供学生社团给不了的支持和保护。'}
                        </p>
                        <p>
                            {isEnglish
                                ? "You're also welcome to come to us, so we can take the steps we need to within the club. Message any officer you're comfortable with on Discord or WeChat, or through our social media. If an officer is the person involved, reach out to a different officer or go straight to UW."
                                : '同时也欢迎你告诉我们，让我们在社团内部采取必要的措施。你可以通过 Discord、微信或我们的社交媒体账号，联系任何一位你信得过的社团干部。如果当事人就是社团干部，请联系另一位干部，或直接联系学校。'}
                        </p>
                        <p>
                            {isEnglish
                                ? "We're students too, not trained advocates or investigators, so we can't replace UW's support. We will listen, and we will take what you tell us seriously."
                                : '我们同样是学生，不是专业的倡导员或调查人员，无法取代学校的支持。但我们会认真倾听，并严肃对待你告诉我们的事情。'}
                        </p>
                        <div className="support-actions">
                            {config.teamMembers.length > 0 && (
                                <Link className="support-action" to="/#team">
                                    <FaUsers aria-hidden="true"/>
                                    {isEnglish ? 'See who our officers are' : '查看社团干部'}
                                </Link>
                            )}
                            {CLUB_SOCIALS.filter(({key}) => config.socialLinks[key]).map(({key, Icon}) => (
                                <a
                                    key={key}
                                    className="support-action"
                                    href={config.socialLinks[key]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Icon aria-hidden="true"/>
                                    {t(SOCIAL_LINK_NAMES[key])}
                                </a>
                            ))}
                        </div>
                    </section>

                    <section className="support-section" aria-labelledby="support-others">
                        <h2 id="support-others">{isEnglish ? 'Reporting for someone else' : '替他人举报'}</h2>
                        <p>
                            {isEnglish
                                ? "You don't have to be the person it happened to. If you've seen or heard about something that worries you, SafeCampus can talk through how to help, and UW's Civil Rights & Title IX Report takes reports about things you witnessed or learned about. If a club member is involved, you can tell any officer as well."
                                : '你不必是当事人。如果你看到或听说了令你担心的事情，可以联系 SafeCampus 商量如何提供帮助，也可以通过 UW 的民权与 Title IX 举报渠道，说明你所见或得知的情况。如果涉及社团成员，同样可以告诉任何一位社团干部。'}
                        </p>
                        <div className="support-actions">
                            {renderAction(SAFECAMPUS_PHONE)}
                            {renderAction(MAKE_A_REPORT)}
                        </div>
                    </section>

                    <p className="policy-updated">
                        {isEnglish
                            ? `UW contact details last checked ${CHECKED.en}.`
                            : `UW 联系方式最近核对于 ${CHECKED.zh}。`}
                    </p>
                    <a href="/" className="policy-back-link">
                        {isEnglish ? '← Back to Home' : '← 返回首页'}
                    </a>
                </main>
            </div>
            <GoToTop/>
        </>
    );
};
