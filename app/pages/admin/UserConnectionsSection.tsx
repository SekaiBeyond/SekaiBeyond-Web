import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { APP_PLATFORM_NAMES, appNameIn } from '~/lib/appLinks';
import { callClearAppLinkHold, callGetUserAppLinks, type UserAppLink } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import { useLoaded } from '~/lib/useLoaded';
import { appBrand, ConnectionRow, type ConnectionStatus } from '~/pages/ProfileConnectionRow';
import type { UserRecord } from './types';
import type { UserSignIn } from './UserSignInSection';
import type { ShowToast } from './utils';

const fetchUserAppLinks = async (uid: string): Promise<UserAppLink[]> => (await callGetUserAppLinks({uid})).data.apps;

export const UserConnectionsSection = ({user, signIn, canManage, showToast}: {
    user: UserRecord;
    signIn: UserSignIn;
    canManage: boolean;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const {data: apps, failed, setData: setApps} = useLoaded(user.uid, fetchUserAppLinks);
    const [busyApp, setBusyApp] = useState<string | null>(null);

    const fmt = (iso: string) => formatSiteTime(new Date(iso), isEnglish, {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    const lift = async (app: UserAppLink) => {
        const appName = appNameIn(app, app.appId, isEnglish);
        if (!window.confirm(isEnglish
            ? `Let ${user.displayName} link another ${appName} account now? Only do this when the one they were linked to was theirs too, or wasn't theirs at all.`
            : `允许 ${user.displayName} 现在绑定另一个${appName}账号吗？仅在其此前绑定的账号也属于本人、或根本不是本人时才这样做。`)) return;
        setBusyApp(app.appId);
        try {
            await callClearAppLinkHold({targetUid: user.uid, appId: app.appId});
            setApps(prev => prev?.flatMap(a => a.appId !== app.appId
                ? [a]
                : a.link || a.accountLinking ? [{...a, hold: null}] : []) ?? null);
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

    const {methods} = signIn;

    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">{isEnglish ? 'Connected Accounts' : '关联账号'}</h4>
            <div className="settings-rows">
                <ConnectionRow
                    brand="google"
                    title="Google"
                    kind={isEnglish ? 'Sign-in method' : '登录方式'}
                    status={methods
                        ? (methods.googleEmail
                            ? {value: 'on', label: isEnglish ? 'Connected' : '已绑定'}
                            : {value: 'off', label: isEnglish ? 'Not connected' : '未绑定'})
                        : undefined}
                    help={signIn.failed
                        ? (isEnglish ? 'Couldn’t load this.' : '加载失败。')
                        : !methods
                            ? (isEnglish ? 'Loading…' : '加载中…')
                            : methods.googleEmail ?? (isEnglish ? 'No Google account bound.' : '未绑定 Google 账号。')}
                />

                {failed ? (
                    <ConnectionRow
                        brand="app"
                        title={isEnglish ? 'Linked apps' : '已绑定的应用'}
                        help={isEnglish ? 'Couldn’t load this.' : '加载失败。'}
                    />
                ) : !apps ? (
                    <div className="settings-row">
                        <div className="spinner spinner-centered"/>
                    </div>
                ) : apps.map(app => {
                    const platform = app.platform ? APP_PLATFORM_NAMES[app.platform] : null;
                    const status: ConnectionStatus = !app.link ? 'off' : app.accountLinking ? 'on' : 'paused';
                    const link = app.link;
                    return (
                        <ConnectionRow
                            key={app.appId}
                            brand={appBrand(app.platform)}
                            iconUrl={app.iconUrl}
                            title={appNameIn(app, app.appId, isEnglish)}
                            kind={platform ? (isEnglish ? platform.en : platform.zh) : (isEnglish ? 'App' : '应用')}
                            status={{
                                value: status,
                                label: {
                                    on: isEnglish ? 'Linked' : '已绑定',
                                    off: isEnglish ? 'Not linked' : '未绑定',
                                    paused: isEnglish ? 'Paused' : '已暂停',
                                }[status],
                            }}
                            help={link
                                ? (isEnglish
                                    ? <>Linked
                                        to <strong>{link.appUserName || 'an account'}</strong> (ID {link.appUserId}){link.linkedAt ? ` since ${fmt(link.linkedAt)}` : ''}.</>
                                    : <>已绑定{link.appUserName ?
                                        <strong>“{link.appUserName}”</strong> : '一个账号'}（ID {link.appUserId}）{link.linkedAt ? `，绑定于 ${fmt(link.linkedAt)}` : ''}。</>)
                                : app.accountLinking
                                    ? (isEnglish ? 'They can link it from Settings on the site.' : '可在本站“设置”中绑定。')
                                    : (isEnglish ? 'Linking is off for this app.' : '此应用的绑定功能已关闭。')}
                            state={app.hold
                                ? (isEnglish
                                    ? `Can only link app account ${app.hold.appUserId} until ${fmt(app.hold.until)}.`
                                    : `在 ${fmt(app.hold.until)} 前只能绑定应用账号 ${app.hold.appUserId}。`)
                                : link && !app.accountLinking
                                    ? (isEnglish
                                        ? 'Linking is paused for this app, so it can’t see this account for now.'
                                        : '此应用的绑定功能已暂停，目前无法查看该账号的信息。')
                                    : undefined}
                            action={canManage && app.hold && (
                                <button
                                    type="button"
                                    className="profile-action"
                                    disabled={busyApp === app.appId}
                                    onClick={() => void lift(app)}
                                >
                                    {isEnglish ? 'Lift hold' : '解除等待期'}
                                </button>
                            )}
                        />
                    );
                })}
            </div>
        </div>
    );
};
