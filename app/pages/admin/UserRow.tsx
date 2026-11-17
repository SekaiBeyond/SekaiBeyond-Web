import type { ReactNode } from 'react';

interface UserRowProps {
    user: {photoURL: string; displayName: string; email: string};
    onClick?: () => void;
    children?: ReactNode;
}

export function UserAvatar({photoURL, displayName, className = 'admin-user-avatar', onClick}: {
    photoURL: string;
    displayName: string;
    className?: string;
    onClick?: () => void;
}) {
    return photoURL ? (
        <img src={photoURL} alt="" className={className} referrerPolicy="no-referrer" onClick={onClick}/>
    ) : (
        <span className={`${className} admin-user-avatar-initial`} aria-hidden="true" onClick={onClick}>
            {Array.from(displayName.trim())[0]?.toUpperCase() ?? '?'}
        </span>
    );
}

export function UserRow({user, onClick, children}: UserRowProps) {
    return (
        <div
            className="admin-user-row"
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            } : undefined}
        >
            <UserAvatar photoURL={user.photoURL} displayName={user.displayName}/>
            <div className="admin-user-info">
                <div className="admin-user-name">{user.displayName}</div>
                <div className="admin-user-email">{user.email}</div>
            </div>
            {children}
        </div>
    );
}
