import type { ReactNode } from 'react';

interface UserRowProps {
    user: {photoURL: string; displayName: string; email: string};
    onClick?: () => void;
    /** Trailing content (group tag, action buttons) — pushed to the right edge of the row. */
    children?: ReactNode;
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
            <img src={user.photoURL} alt="" className="admin-user-avatar"
                 referrerPolicy="no-referrer"/>
            <div className="admin-user-info">
                <div className="admin-user-name">{user.displayName}</div>
                <div className="admin-user-email">{user.email}</div>
            </div>
            {children}
        </div>
    );
}
