import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { FiAlertCircle, FiAward, FiBookOpen, FiCalendar, FiLock } from 'react-icons/fi';
import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import { openRedeemModal } from '~/components/RedeemModal';
import { useUpcomingEvents } from '~/lib/upcomingEvents';

export const ProfileCard = ({title, count, compact, children}: {
    title?: string;
    count?: number;
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

const IconTile = ({icon: Icon, muted}: {icon: IconType; muted?: boolean}) => (
    <span className={`profile-icon-tile${muted ? ' profile-icon-tile--muted' : ''}`} aria-hidden="true">
        <Icon/>
    </span>
);

export const ProfileCardNote = ({icon, muted, action, children}: {
    icon: IconType;
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

const ProfileAction = ({to, onClick, children}: {to?: string; onClick?: () => void; children: ReactNode}) =>
    to
        ? <Link to={to} className="profile-action">{children}</Link>
        : <button type="button" className="profile-action" onClick={onClick}>{children}</button>;

type CollectionKind = 'events' | 'badges' | 'passports';

interface CollectionPrompt {
    icon: IconType;
    title: string;
    how: string;
    none: string;
    action: ReactNode;
}

function useCollectionPrompts(checkedIn: boolean): Record<CollectionKind, CollectionPrompt> {
    const {isEnglish} = useLanguage();
    const {hasActive} = useUpcomingEvents();

    return {
        events: {
            icon: FiCalendar,
            title: checkedIn
                ? (isEnglish ? 'You’re checked in' : '你已签到')
                : (isEnglish ? 'Check in at an event' : '参加一场活动'),
            how: checkedIn
                ? (isEnglish
                    ? 'The event you checked in to shows up here once it wraps up.'
                    : '你签到的活动结束后会显示在这里。')
                : (isEnglish
                    ? 'Check in at a club event — with its QR code or your ticket — and it shows up here.'
                    : '在社团活动现场签到（扫描活动二维码或出示门票），活动就会显示在这里。'),
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
                ? 'A physical passport adds membership time and a page of your own. Enter the key from the slip packed with it to activate it.'
                : '一本实体通行证可为你增加会员时长，并带来一个属于你的页面。输入随附纸条上的激活码即可激活。',
            none: isEnglish ? 'No passports yet.' : '还没有通行证。',
            action: (
                <ProfileAction onClick={openRedeemModal}>
                    {isEnglish ? 'Enter passport key' : '输入激活码'}
                </ProfileAction>
            ),
        },
    };
}

const OwnEmptyNote = ({kind, checkedIn}: {kind: CollectionKind; checkedIn: boolean}) => {
    const prompt = useCollectionPrompts(checkedIn)[kind];
    return (
        <ProfileCardNote icon={prompt.icon} action={prompt.action}>
            <strong>{prompt.none}</strong> {prompt.how}
        </ProfileCardNote>
    );
};

export type SectionState = 'loading' | 'failed' | 'private' | 'empty' | 'filled';

export const ProfileSection = ({
                                   kind,
                                   title,
                                   state,
                                   count,
                                   own,
                                   checkedIn = false,
                                   icon = FiAward,
                                   none,
                                   hidden,
                                   failed,
                                   children,
                               }: {
    kind: CollectionKind;
    title: string;
    state: SectionState;
    count: number;
    own: boolean;
    checkedIn?: boolean;
    icon?: IconType;
    none?: string;
    hidden?: string;
    failed?: string;
    children: ReactNode;
}) => (
    <ProfileCard title={title} count={state === 'filled' ? count : undefined} compact={state !== 'filled'}>
        {state === 'filled' ? children
            : state === 'loading' ? <div className="spinner spinner-centered"/>
                : state === 'failed' ? <ProfileCardNote icon={FiAlertCircle} muted>{failed}</ProfileCardNote>
                    : state === 'private' ? <ProfileCardNote icon={FiLock} muted>{hidden}</ProfileCardNote>
                        : own ? <OwnEmptyNote kind={kind} checkedIn={checkedIn}/>
                            : <ProfileCardNote icon={icon} muted>{none}</ProfileCardNote>}
    </ProfileCard>
);

const WELCOME_ORDER: CollectionKind[] = ['events', 'badges', 'passports'];

export const ProfileWelcome = ({checkedIn = false}: {checkedIn?: boolean}) => {
    const {isEnglish} = useLanguage();
    const prompts = useCollectionPrompts(checkedIn);

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
