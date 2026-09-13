import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { FiAlertCircle, FiAward, FiBookOpen, FiCalendar, FiLock } from 'react-icons/fi';
import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import { openRedeemModal } from '~/components/RedeemModal';
import { useUpcomingEvents } from '~/lib/upcomingEvents';

/**
 * The pieces /profile builds its collections from: a card per section, the
 * one-line note a section shows instead of a grid, and the welcome card a brand
 * new account sees in place of three empty sections.
 */

/** A titled section of the profile, with its count beside the title. */
export const ProfileCard = ({title, count, compact, children}: {
    title?: string;
    /** Left off for a section with nothing to count, or nothing shown. */
    count?: number;
    /** A section holding only a note rather than a grid. */
    compact?: boolean;
    children: ReactNode;
}) => (
    <section className={`profile-card${compact ? ' profile-card--compact' : ''}`}>
        {title && (
            <div className="profile-card-head">
                <h2 className="profile-card-title">{title}</h2>
                {count != null && count > 0 && <span className="profile-card-count">{count}</span>}
            </div>
        )}
        {children}
    </section>
);

/** An icon in a soft rounded tile — the leading mark of a note or a welcome step. */
const IconTile = ({icon: Icon, muted}: {icon: IconType; muted?: boolean}) => (
    <span className={`profile-icon-tile${muted ? ' profile-icon-tile--muted' : ''}`} aria-hidden="true">
        <Icon/>
    </span>
);

/** What a section says when it has no grid to show: empty, private, or failed. */
export const ProfileCardNote = ({icon, muted, action, children}: {
    icon: IconType;
    /** Grey rather than pink, for a state the viewer can't do anything about. */
    muted?: boolean;
    action?: ReactNode;
    children: ReactNode;
}) => (
    <div className="profile-card-note">
        <IconTile icon={icon} muted={muted}/>
        <p className="profile-card-note-text">{children}</p>
        {action}
    </div>
);

/** A pill-shaped link or button for a note or a welcome step. */
const ProfileAction = ({to, onClick, children}: {to?: string; onClick?: () => void; children: ReactNode}) =>
    to
        ? <Link to={to} className="profile-action">{children}</Link>
        : <button type="button" className="profile-action" onClick={onClick}>{children}</button>;

export type CollectionKind = 'events' | 'badges' | 'passports';

interface CollectionPrompt {
    icon: IconType;
    /** The welcome step's heading. */
    title: string;
    /** How this collection fills up — also the tail of that section's empty note. */
    how: string;
    /** The section's empty note opens with this. */
    none: string;
    action: ReactNode;
}

/**
 * How each collection on your own profile fills up, and the button that starts
 * it. Events are logged by checking in, and both badge codes and passport codes
 * go through Redeem Code — a passport code then hands off to /p/:id for its key.
 */
function useCollectionPrompts(): Record<CollectionKind, CollectionPrompt> {
    const {isEnglish} = useLanguage();
    // The home page hides its upcoming section when nothing is scheduled, so a
    // link to it would scroll nowhere; point at the past events instead.
    const {hasActive} = useUpcomingEvents();

    return {
        events: {
            icon: FiCalendar,
            title: isEnglish ? 'Check in at an event' : '参加一场活动',
            how: isEnglish
                ? 'Check in at a club event — with its QR code or your ticket — and it shows up here.'
                : '在社团活动现场签到（扫描活动二维码或出示门票），活动就会显示在这里。',
            none: isEnglish ? 'No events yet.' : '还没有参加过活动。',
            action: hasActive ? (
                <ProfileAction to="/#upcoming">
                    {isEnglish ? 'See upcoming events' : '查看即将举行的活动'}
                </ProfileAction>
            ) : (
                <ProfileAction to="/#events">
                    {isEnglish ? 'See what we host' : '看看我们的活动'}
                </ProfileAction>
            ),
        },
        badges: {
            icon: FiAward,
            title: isEnglish ? 'Earn a badge' : '获得徽章',
            how: isEnglish
                ? 'Badge codes are handed out at events and challenges. Got one? Redeem it here.'
                : '徽章兑换码会在活动和挑战中发放。拿到了？在这里兑换。',
            none: isEnglish ? 'No badges yet.' : '还没有徽章。',
            action: (
                <ProfileAction onClick={openRedeemModal}>
                    {isEnglish ? 'Redeem a code' : '兑换激活码'}
                </ProfileAction>
            ),
        },
        passports: {
            icon: FiBookOpen,
            title: isEnglish ? 'Activate a passport' : '激活通行证',
            how: isEnglish
                ? 'A physical passport adds a year of membership and a page of your own. Scan its sticker, or enter the code printed on it.'
                : '一本实体通行证可为你带来一年会员资格和一个属于你的页面。扫描贴纸，或输入上面印的编号即可激活。',
            none: isEnglish ? 'No passports yet.' : '还没有通行证。',
            action: (
                <ProfileAction onClick={openRedeemModal}>
                    {isEnglish ? 'Enter passport code' : '输入通行证编号'}
                </ProfileAction>
            ),
        },
    };
}

/** Your own empty section: what it is waiting for, and the button that starts it. */
export const OwnEmptyNote = ({kind}: {kind: CollectionKind}) => {
    const prompt = useCollectionPrompts()[kind];
    return (
        <ProfileCardNote icon={prompt.icon} action={prompt.action}>
            <strong>{prompt.none}</strong> {prompt.how}
        </ProfileCardNote>
    );
};

/** Where a section of the profile stands, which decides what its card holds. */
export type SectionState = 'loading' | 'failed' | 'private' | 'empty' | 'filled';

/**
 * One collection on the profile. Filled, it is its grid under a counted title;
 * otherwise it shrinks to a single note. An empty section of your own says how
 * to fill it; someone else's just says it is empty.
 */
export const ProfileSection = ({kind, title, state, count, own, icon = FiAward, none, hidden, failed, children}: {
    kind: CollectionKind;
    title: string;
    state: SectionState;
    count: number;
    own: boolean;
    /** Leads the note on someone else's empty section. */
    icon?: IconType;
    /** Someone else's empty section. */
    none?: string;
    /** Someone else's private section. */
    hidden?: string;
    failed?: string;
    /** The grid, drawn only once the section is filled. */
    children: ReactNode;
}) => (
    <ProfileCard title={title} count={state === 'filled' ? count : undefined} compact={state !== 'filled'}>
        {state === 'filled' ? children
            : state === 'loading' ? <div className="spinner spinner-centered"/>
                : state === 'failed' ? <ProfileCardNote icon={FiAlertCircle} muted>{failed}</ProfileCardNote>
                    : state === 'private' ? <ProfileCardNote icon={FiLock} muted>{hidden}</ProfileCardNote>
                        : own ? <OwnEmptyNote kind={kind}/>
                            : <ProfileCardNote icon={icon} muted>{none}</ProfileCardNote>}
    </ProfileCard>
);

const WELCOME_ORDER: CollectionKind[] = ['events', 'badges', 'passports'];

/**
 * A brand-new account's profile: one card of the three ways in, rather than
 * three sections each saying it is empty. It goes away as soon as any one of
 * them has something in it.
 */
export const ProfileWelcome = () => {
    const {isEnglish} = useLanguage();
    const prompts = useCollectionPrompts();

    return (
        <section className="profile-welcome">
            <h2 className="profile-welcome-title">
                {isEnglish ? 'Start your collection' : '开始你的收藏'}
            </h2>
            <p className="profile-welcome-lead">
                {isEnglish
                    ? 'The events you check in to, the badges you earn and the passports you hold all end up on this page.'
                    : '你参加过的活动、获得的徽章和持有的通行证，都会展示在这里。'}
            </p>
            <ol className="profile-welcome-steps">
                {WELCOME_ORDER.map(kind => {
                    const prompt = prompts[kind];
                    return (
                        <li key={kind} className="profile-welcome-step">
                            <IconTile icon={prompt.icon}/>
                            <h3 className="profile-welcome-step-title">{prompt.title}</h3>
                            <p className="profile-welcome-step-text">{prompt.how}</p>
                            {prompt.action}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};
