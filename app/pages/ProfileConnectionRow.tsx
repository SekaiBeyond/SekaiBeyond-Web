import type { ReactNode } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { FiGrid } from 'react-icons/fi';
import { SiWechat } from 'react-icons/si';
import type { AppPlatform } from '~/lib/appLinks';

/** Whose mark a row's tile shows: Google's, WeChat's, or a plain one for any other app. */
export type ConnectionBrand = 'google' | 'wechat' | 'app';

export const appBrand = (platform: AppPlatform): ConnectionBrand =>
    platform === 'wechat-mini-program' ? 'wechat' : 'app';

const BRAND_ICONS = {google: FcGoogle, wechat: SiWechat, app: FiGrid} as const;

/**
 * A brand's mark on its tile: a row's, or, `small`, beside a name, as in the
 * Apps tool. An app's own icon, `imageUrl`, takes the mark's place.
 */
export const ConnectionIcon = ({brand, imageUrl, small = false}: {
    brand: ConnectionBrand;
    imageUrl?: string;
    small?: boolean;
}) => {
    if (imageUrl) {
        return (
            <img
                className={`settings-connection-icon settings-connection-icon--image${small ? ' settings-connection-icon--small' : ''}`}
                src={imageUrl}
                alt=""
            />
        );
    }
    const Icon = BRAND_ICONS[brand];
    return (
        <span
            className={`settings-connection-icon settings-connection-icon--${brand}${small ? ' settings-connection-icon--small' : ''}`}
            aria-hidden="true"
        >
            <Icon/>
        </span>
    );
};

/** Connected, not, or connected but switched off on the other side for now. */
export type ConnectionStatus = 'on' | 'off' | 'paused';

/**
 * One row of a Connected Accounts list, in Settings or on an account's page in
 * the admin Users tab: the other side's mark, its
 * name with what it is under it, a badge saying whether it's connected, then
 * the details, the button, and under them anything the button opens.
 */
export const ConnectionRow = ({brand, iconUrl, title, kind, status, help, state, details, action, children}: {
    brand: ConnectionBrand;
    /** An app's own icon, shown in place of `brand`'s mark. */
    iconUrl?: string;
    title: string;
    /** What it is, as "Sign-in method" or "WeChat mini program". */
    kind?: string;
    /** Left out while what it is can't be told. */
    status?: {value: ConnectionStatus; label: string};
    help?: ReactNode;
    state?: string;
    details?: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
}) => (
    <div className="settings-row settings-row--connection">
        <ConnectionIcon brand={brand} imageUrl={iconUrl}/>
        <div className="settings-row-text">
            <span className="settings-connection-head">
                <span className="settings-row-title">{title}</span>
                {status && (
                    <span className={`settings-connection-badge settings-connection-badge--${status.value}`}>
                        {status.label}
                    </span>
                )}
            </span>
            {kind && <span className="settings-connection-kind">{kind}</span>}
            {help && <span className="settings-row-help">{help}</span>}
            {state && <span className="settings-row-state">{state}</span>}
            {details}
        </div>
        {action}
        {children && <div className="settings-connection-panel">{children}</div>}
    </div>
);
