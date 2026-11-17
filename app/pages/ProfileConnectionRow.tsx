import type { ReactNode } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { FiGrid } from 'react-icons/fi';
import { SiWechat } from 'react-icons/si';
import type { AppPlatform } from '~/lib/appLinks';

type ConnectionBrand = 'google' | 'wechat' | 'app';

export const appBrand = (platform: AppPlatform): ConnectionBrand =>
    platform === 'wechat-mini-program' ? 'wechat' : 'app';

const BRAND_ICONS = {google: FcGoogle, wechat: SiWechat, app: FiGrid} as const;

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

export type ConnectionStatus = 'on' | 'off' | 'paused';

export const ConnectionRow = ({brand, iconUrl, title, kind, status, help, state, details, action, children}: {
    brand: ConnectionBrand;
    iconUrl?: string;
    title: string;
    kind?: string;
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
