import { type Localized, useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

const PARAGRAPHS: Localized[] = [
    {
        en: 'Sekai Beyond Con is our annual celebration of the worlds we grew up in — anime, comics, games, and the music that came with them. It started as a student-run afternoon of performances and has grown into a full day of stages, markets, and meetups open to everyone.',
        zh: '彼世界动漫游戏展是我们一年一度的庆典，献给陪我们长大的那些世界——动漫、漫画、游戏，以及与之相伴的音乐。它最初只是学生自办的一个演出下午，如今已成长为面向所有人的整日舞台、市集与聚会。',
    },
    {
        en: 'Everything you see is built by volunteers from the Sekai Beyond community: the stage crew, the artists in the marketplace, the cosplayers on stage, and the students running the door. Come for the line-up, stay for the people.',
        zh: '你所看到的一切都由 Sekai Beyond 社区的志愿者共同搭建：舞台组、市集上的创作者、登台的 Coser，以及在门口值班的同学。为节目而来，为伙伴留下。',
    },
];

interface Highlight {
    icon: string
    label: Localized
    blurb: Localized
}

const HIGHLIGHTS: Highlight[] = [
    {
        icon: '🎤',
        label: {en: 'Live Stage', zh: '现场舞台'},
        blurb: {
            en: 'A band set at noon, the idol fest through the afternoon, and a DJ to close the night.',
            zh: '中午的乐队演出、整个下午的偶像祭，以及压轴的 DJ 现场。',
        },
    },
    {
        icon: '🎨',
        label: {en: 'Marketplace', zh: '市集'},
        blurb: {
            en: 'Prints, charms, and originals straight from the illustrators who made them, 11:00 to 18:00.',
            zh: '海报、挂件与原创周边，直接来自绘师本人，11:00 至 18:00 开放。',
        },
    },
    {
        icon: '👗',
        label: {en: 'Cosplay Contest', zh: 'Cosplay 大赛'},
        blurb: {
            en: 'Take the main stage solo or with your group in the afternoon contest block.',
            zh: '下午的主舞台大赛时段，个人或团体皆可登台。',
        },
    },
    {
        icon: '🎧',
        label: {en: 'Idol Stages', zh: '偶像舞台'},
        blurb: {
            en: 'Idolfest, call & mix, and guest sets running in HUB 334 and 337 from noon onwards.',
            zh: '偶像祭、Call & Mix 与嘉宾演出，自中午起在 HUB 334 与 337 轮番上演。',
        },
    },
    {
        icon: '☕',
        label: {en: 'Maid Café', zh: '女仆咖啡'},
        blurb: {
            en: 'ACGNUW runs the café in HUB 214 from lunchtime through the late afternoon.',
            zh: 'ACGNUW 在 HUB 214 运营女仆咖啡，从午后开放至傍晚。',
        },
    },
    {
        icon: '🎃',
        label: {en: 'Kawalloween', zh: 'Kawalloween'},
        blurb: {
            en: 'The evening block in HUB 214, running until 19:30.',
            zh: '傍晚于 HUB 214 的企划，持续至 19:30。',
        },
    },
];

export const About = () => {
    const t = useT();

    return (
        <section id="about" className="sbc-section">
            <SectionHeader
                title={{en: 'About the con', zh: '关于漫展'}}
                subtitle={{
                    en: 'Student-run, open to everyone, and shaped by whoever shows up to help.',
                    zh: '学生自办，向所有人开放，由每一位参与者共同塑造。',
                }}
            />

            <div className="sbc-about-text">
                {PARAGRAPHS.map((paragraph, i) => (
                    <p key={i}>{t(paragraph)}</p>
                ))}
            </div>

            <div className="sbc-highlight-grid">
                {HIGHLIGHTS.map(highlight => (
                    <article key={highlight.label.en} className="sbc-highlight">
                        <h3 className="sbc-highlight-label">
                            <span className="sbc-highlight-icon" aria-hidden="true">{highlight.icon}</span>
                            {t(highlight.label)}
                        </h3>
                        <p className="sbc-highlight-blurb">{t(highlight.blurb)}</p>
                    </article>
                ))}
            </div>
        </section>
    );
};
