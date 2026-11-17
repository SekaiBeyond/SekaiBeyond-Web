import { type ReactNode, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { functionsErrorCode } from '~/lib/firebase';
import { refreshAfterSave, type ShowToast } from './utils';

interface UseEventLifecycleOptions {
    requestDeletion: (data: {eventId: string}) => Promise<unknown>;
    cancelDeletion: (data: {eventId: string}) => Promise<unknown>;
    setPublished: (data: {eventId: string; published: boolean}) => Promise<unknown>;
    refresh: () => Promise<void>;
    showToast: ShowToast;
}

export function useEventLifecycle({
                                      requestDeletion,
                                      cancelDeletion,
                                      setPublished,
                                      refresh,
                                      showToast,
                                  }: UseEventLifecycleOptions) {
    const {isEnglish} = useLanguage();
    const [deletionBusyId, setDeletionBusyId] = useState<string | null>(null);

    const requestDeleteEvent = async (event: {id: string; title: string}) => {
        if (!confirm(isEnglish
            ? `Request deletion of "${event.title}"? It will be permanently deleted in about 48 hours unless cancelled.`
            : `申请删除"${event.title}"？如不取消，约 48 小时后将被永久删除。`
        )) return;
        setDeletionBusyId(event.id);
        try {
            await requestDeletion({eventId: event.id});
            await refreshAfterSave(refresh, showToast, isEnglish);
            showToast(isEnglish ? 'Deletion scheduled.' : '已计划删除。', 'warning');
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = code === 'deletion-already-pending'
                ? (isEnglish
                    ? 'Deletion already pending — cancel it first.'
                    : '已在计划删除中，请先取消。')
                : (isEnglish ? 'Failed to schedule deletion.' : '计划删除失败。');
            showToast(msg, 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const cancelDeleteEvent = async (event: {id: string}) => {
        setDeletionBusyId(event.id);
        try {
            await cancelDeletion({eventId: event.id});
            await refreshAfterSave(refresh, showToast, isEnglish);
            showToast(isEnglish ? 'Deletion cancelled.' : '已取消删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to cancel deletion.' : '取消删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const togglePublish = async (event: {id: string; published: boolean}) => {
        const newPublished = !event.published;
        try {
            await setPublished({eventId: event.id, published: newPublished});
            await refreshAfterSave(refresh, showToast, isEnglish);
            showToast(
                newPublished
                    ? (isEnglish ? 'Event published.' : '活动已发布。')
                    : (isEnglish ? 'Event unpublished.' : '活动已取消发布。'),
                newPublished ? 'success' : 'warning',
            );
        } catch (err) {
            console.error('[togglePublish]', err);
            showToast(isEnglish ? 'Failed to update publish status.' : '更新发布状态失败。', 'error');
        }
    };

    return {deletionBusyId, requestDeleteEvent, cancelDeleteEvent, togglePublish};
}

type EventLifecycle = ReturnType<typeof useEventLifecycle>;

export function EventActions({event, onEdit, lifecycle, children}: {
    event: {id: string; title: string; published: boolean; deleteAt: Date | null};
    onEdit: () => void;
    lifecycle: EventLifecycle;
    children?: ReactNode;
}) {
    const {isEnglish} = useLanguage();
    const busy = lifecycle.deletionBusyId === event.id;
    const busyLabel = isEnglish ? 'Working...' : '处理中...';
    return (
        <div className="admin-form-actions admin-section-mb">
            <button className="admin-toggle-btn admin-toggle-edit" onClick={onEdit}>
                {isEnglish ? 'Edit Event' : '编辑活动'}
            </button>
            <button
                className={`admin-toggle-btn ${event.published ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                onClick={() => lifecycle.togglePublish(event)}
            >
                {event.published
                    ? (isEnglish ? 'Unpublish' : '取消发布')
                    : (isEnglish ? 'Publish' : '发布')}
            </button>
            {event.deleteAt ? (
                <button className="admin-toggle-btn admin-toggle-grant"
                        onClick={() => lifecycle.cancelDeleteEvent(event)} disabled={busy}>
                    {busy ? busyLabel : (isEnglish ? 'Cancel deletion' : '取消删除')}
                </button>
            ) : (
                <button className="admin-toggle-btn admin-toggle-revoke"
                        onClick={() => lifecycle.requestDeleteEvent(event)} disabled={busy}>
                    {busy ? busyLabel : (isEnglish ? 'Delete Event' : '删除活动')}
                </button>
            )}
            {children}
        </div>
    );
}

export function EventDetailHeader({image, title, description, onBack, backLabel, children}: {
    image: string;
    title: string;
    description?: string;
    onBack: () => void;
    backLabel: string;
    children: ReactNode;
}) {
    return (
        <>
            <button className="admin-btn admin-btn--link" onClick={onBack}>
                &larr; {backLabel}
            </button>
            <div className="admin-event-detail-header">
                {image && <img src={image} alt="" className="admin-event-detail-img"/>}
                <div>
                    <h3>{title}</h3>
                    <p className="admin-event-detail-meta">{children}</p>
                    {description !== undefined && <p className="admin-description-text">{description}</p>}
                </div>
            </div>
        </>
    );
}

export function SubTab({active, onClick, count, children}: {
    active: boolean;
    onClick: () => void;
    count?: number | null;
    children: ReactNode;
}) {
    return (
        <button className={`admin-sub-tab ${active ? 'admin-sub-tab-active' : ''}`} onClick={onClick}>
            {children}
            {count != null && count > 0 && <span className="admin-sub-tab-count">{count}</span>}
        </button>
    );
}

export function PendingDeletionNote({deleteAt}: {deleteAt: Date | null}) {
    const {isEnglish} = useLanguage();
    if (!deleteAt) return null;
    const stamp = deleteAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return (
        <p className="admin-helper-text">
            {isEnglish
                ? `Pending deletion — scheduled around ${stamp}.`
                : `待删除 — 预计于 ${stamp} 前后执行。`}
        </p>
    );
}
