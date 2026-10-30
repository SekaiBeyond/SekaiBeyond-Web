import { useState } from 'react';
import type { IconType } from 'react-icons';
import { FiMonitor, FiSmartphone, FiTablet } from 'react-icons/fi';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callEndOtherSessions, callEndSession } from '~/lib/firebase';
import { deviceName, type DeviceSession, useDeviceSessions } from '~/lib/sessions';
import type { ShowToast } from '~/lib/useToasts';

const DEVICE_ICONS: Record<DeviceSession['device'], IconType> = {
    mobile: FiSmartphone,
    tablet: FiTablet,
    desktop: FiMonitor,
};

/**
 * /profile's Settings tab: the devices signed in to the account, each with a
 * button to sign it out. Another device is signed out at once if it's open,
 * or the next time it is; this one signs out as the menu's Sign Out does.
 */
export const ProfileDevicesSection = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {user, sessionId, signOut} = useAuth();
    const {sessions, failed} = useDeviceSessions(user?.uid ?? null);
    // A session ID, or 'others' for the sign-out-everywhere-else button.
    const [busy, setBusy] = useState<string | null>(null);

    const locale = isEnglish ? 'en-US' : 'zh-CN';
    const day = (date: Date) => date.toLocaleDateString(locale, {year: 'numeric', month: 'short', day: 'numeric'});
    const moment = (date: Date) => date.toLocaleString(locale, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    // This device first, then the rest by when they were last used.
    const ordered = sessions && [
        ...sessions.filter(s => s.id === sessionId),
        ...sessions.filter(s => s.id !== sessionId),
    ];
    const othersCount = sessions?.filter(s => s.id !== sessionId).length ?? 0;

    const signOutDevice = async (session: DeviceSession) => {
        if (session.id === sessionId) {
            await signOut();
            return;
        }
        setBusy(session.id);
        try {
            await callEndSession({sessionId: session.id});
            const name = deviceName(session, isEnglish);
            showToast(isEnglish ? `Signed out of ${name}.` : `已退出 ${name}。`, 'success');
        } catch {
            showToast(isEnglish ? 'Failed to sign out that device. Please try again.' : '退出设备失败，请重试。', 'error');
        } finally {
            setBusy(null);
        }
    };

    const signOutOthers = async () => {
        const confirmed = window.confirm(
            isEnglish
                ? 'Sign out of every other device? Each will have to sign in again.'
                : '确定要退出所有其他设备吗？这些设备需要重新登录。',
        );
        if (!confirmed) return;
        setBusy('others');
        try {
            const {data} = await callEndOtherSessions();
            showToast(
                isEnglish
                    ? `Signed out of ${data.ended} other ${data.ended === 1 ? 'device' : 'devices'}.`
                    : `已退出 ${data.ended} 台其他设备。`,
                'success',
            );
        } catch {
            showToast(isEnglish ? 'Failed to sign out other devices. Please try again.' : '退出其他设备失败，请重试。', 'error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Signed-in Devices' : '登录设备'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'The browsers signed in to your account. Signing one out signs it out right away if it’s open, or the next time it’s opened. Sign out any you don’t recognise.'
                    : '已登录您账户的浏览器。退出某台设备后，若它正在使用将立即退出登录，否则会在下次打开时退出。如有不认识的设备，请将其退出。'}
            </p>

            {failed ? (
                <p className="settings-row-help">
                    {isEnglish
                        ? 'Couldn’t load your devices just now. Try reloading the page.'
                        : '暂时无法加载您的设备，请刷新页面重试。'}
                </p>
            ) : !ordered ? (
                <div className="spinner spinner-centered"/>
            ) : ordered.length === 0 ? (
                <p className="settings-row-help">
                    {isEnglish ? 'No devices to show yet.' : '暂无可显示的设备。'}
                </p>
            ) : (
                <div className="settings-rows">
                    {ordered.map(session => {
                        const Icon = DEVICE_ICONS[session.device];
                        const isThis = session.id === sessionId;
                        const name = deviceName(session, isEnglish);
                        const details = [
                            session.signedInAt && (isEnglish
                                ? `Signed in ${day(session.signedInAt)}`
                                : `登录于 ${day(session.signedInAt)}`),
                            !isThis && session.lastActiveAt && (isEnglish
                                ? `Last active ${moment(session.lastActiveAt)}`
                                : `最近活动 ${moment(session.lastActiveAt)}`),
                        ].filter(Boolean).join(' · ');
                        return (
                            <div key={session.id} className="settings-row settings-row--device">
                                <span className="profile-icon-tile" aria-hidden="true"><Icon/></span>
                                <div className="settings-row-text">
                                    <span className="settings-row-title">{name}</span>
                                    {details && <span className="settings-row-help">{details}</span>}
                                    {isThis && (
                                        <span className="settings-row-state">
                                            {isEnglish ? 'This device' : '当前设备'}
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="profile-action settings-device-signout"
                                    disabled={busy !== null || !sessionId}
                                    aria-label={isEnglish ? `Sign out of ${name}` : `退出 ${name}`}
                                    onClick={() => void signOutDevice(session)}
                                >
                                    {busy === session.id
                                        ? (isEnglish ? 'Signing out…' : '退出中…')
                                        : (isEnglish ? 'Sign out' : '退出')}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {othersCount > 0 && (
                <div className="settings-devices-footer">
                    <button
                        type="button"
                        className="profile-action settings-device-signout"
                        disabled={busy !== null || !sessionId}
                        onClick={() => void signOutOthers()}
                    >
                        {busy === 'others'
                            ? (isEnglish ? 'Signing out…' : '退出中…')
                            : (isEnglish ? 'Sign out of all other devices' : '退出所有其他设备')}
                    </button>
                </div>
            )}
        </section>
    );
};
