import type { ReactNode } from 'react';

interface UserRowProps {
    user: {photoURL: string; displayName: string; email: string};
    onClick?: () => void;
    /** Trailing content (group tag, action buttons) — pushed to the right edge of the row. */
    children?: ReactNode;
}

/** A user's photo, or their initial when they have none, rather than a broken image. */
export function UserAvatar({photoURL, displayName, className = 'admin-user-avatar', onClick}: {
    photoURL: string;
    displayName: string;
    /** The size and frame; the list avatar's by default. */
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

/** The avatar + name + email row every admin user list is built from. */
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
