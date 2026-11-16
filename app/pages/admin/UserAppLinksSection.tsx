import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClearAppLinkHold, callGetUserAppLinks, type UserAppLink } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';

/**
 * An account's links to its accounts in registered apps, such as the mini
 * program, and any hold keeping it from linking another there. A hold lasts
 * 30 days after a link is undone, so a membership can't be passed round a
 * group's app accounts; core-staff can lift one early for someone who linked
 * the wrong account of their own. Lifting it is on the Records tab.
 */
export const UserAppLinksSection = ({user, canManage, showToast}: {
    user: UserRecord;
    /** Core-staff+ acting on someone below them, not themselves. Everyone else sees the links only. */
    canManage: boolean;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const [apps, setApps] = useState<UserAppLink[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [busyApp, setBusyApp] = useState<string | null>(null);

    useEffect(() => {
        let stale = false;
        setApps(null);
        setFailed(false);
        callGetUserAppLinks({uid: user.uid})
            .then(result => !stale && setApps(result.data.apps))
            .catch(() => !stale && setFailed(true));
        return () => {
            stale = true;
        };
    }, [user.uid]);

    const fmt = (iso: string) => formatSiteTime(new Date(iso), isEnglish, {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    const lift = async (app: UserAppLink) => {
        if (!window.confirm(isEnglish
            ? `Let ${user.displayName} link another ${app.name} account now? Only do this when the one they were linked to was theirs too, or wasn't theirs at all.`
            : `允许 ${user.displayName} 现在绑定另一个${app.name}账号吗？仅在其此前绑定的账号也属于本人、或根本不是本人时才这样做。`)) return;
        setBusyApp(app.appId);
        try {
            await callClearAppLinkHold({targetUid: user.uid, appId: app.appId});
            setApps(prev => prev?.flatMap(a => a.appId !== app.appId ? [a] : a.link ? [{
                ...a,
                hold: null
            }] : []) ?? null);
            showToast(isEnglish ? 'Hold lifted.' : '已解除等待期。', 'success');
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to lift the hold. You may not have permission for this action.'
                    : '解除等待期失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setBusyApp(null);
        }
    };

    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">{isEnglish ? 'Linked Apps' : '已绑定的应用'}</h4>
            {failed ? (
                <p>{isEnglish ? 'Couldn’t load this.' : '加载失败。'}</p>
            ) : !apps ? (
                <div className="spinner spinner-centered"/>
            ) : apps.length === 0 ? (
                <p>{isEnglish ? 'Not linked in any app.' : '未在任何应用中绑定。'}</p>
            ) : apps.map(app => (
                <div key={app.appId} className="admin-app-link-row">
                    <p>
                        <strong>{app.name}</strong>{isEnglish ? ': ' : '：'}
                        {app.link
                            ? (isEnglish
                                ? `linked to ${app.link.appUserName ? `"${app.link.appUserName}"` : 'an account'} (ID ${app.link.appUserId})${app.link.linkedAt ? ` since ${fmt(app.link.linkedAt)}` : ''}`
                                : `已绑定${app.link.appUserName ? `“${app.link.appUserName}”` : '一个账号'}（ID ${app.link.appUserId}）${app.link.linkedAt ? `，绑定于 ${fmt(app.link.linkedAt)}` : ''}`)
                            : (isEnglish ? 'not linked' : '未绑定')}
                    </p>
                    {app.hold && (
                        <p className="admin-ban-detail">
                            {isEnglish
                                ? `Can only link app account ${app.hold.appUserId} until ${fmt(app.hold.until)}.`
                                : `在 ${fmt(app.hold.until)} 前只能绑定应用账号 ${app.hold.appUserId}。`}
                        </p>
                    )}
                    {canManage && app.hold && (
                        <button
                            type="button"
                            className="admin-btn admin-btn--outline"
                            disabled={busyApp === app.appId}
                            onClick={() => void lift(app)}
                        >
                            {isEnglish ? 'Lift hold' : '解除等待期'}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};
