import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { functionsErrorCode } from '~/lib/firebase';
import type { ShowToast } from './utils';

interface UseEventLifecycleOptions {
    /** Schedule the ~48h delayed deletion (past or upcoming variant of the callable). */
    requestDeletion: (data: {eventId: string}) => Promise<unknown>;
    cancelDeletion: (data: {eventId: string}) => Promise<unknown>;
    setPublished: (data: {eventId: string; published: boolean}) => Promise<unknown>;
    refresh: () => Promise<void>;
    showToast: ShowToast;
}

/**
 * The publish/unpublish and request/cancel-deletion flows shared by the past-
 * and upcoming-events tabs. The tabs differ only in which Cloud Functions back
 * the actions, so those come in as options.
 */
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
            await refresh();
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
            await refresh();
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
            await refresh();
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

export function PublishToggleButton({published, onToggle}: {published: boolean; onToggle: () => void}) {
    const {isEnglish} = useLanguage();
    return (
        <button
            className={`admin-toggle-btn ${published ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
            onClick={onToggle}
        >
            {published
                ? (isEnglish ? 'Unpublish' : '取消发布')
                : (isEnglish ? 'Publish' : '发布')}
        </button>
    );
}

/** "Delete Event" or, when a deletion is already scheduled, "Cancel deletion". */
export function DeleteOrCancelButton({deleteAt, busy, onRequest, onCancel}: {
    deleteAt: Date | null;
    busy: boolean;
    onRequest: () => void;
    onCancel: () => void;
}) {
    const {isEnglish} = useLanguage();
    const busyLabel = isEnglish ? 'Working...' : '处理中...';
    return deleteAt ? (
        <button className="admin-toggle-btn admin-toggle-grant" onClick={onCancel} disabled={busy}>
            {busy ? busyLabel : (isEnglish ? 'Cancel deletion' : '取消删除')}
        </button>
    ) : (
        <button className="admin-toggle-btn admin-toggle-revoke" onClick={onRequest} disabled={busy}>
            {busy ? busyLabel : (isEnglish ? 'Delete Event' : '删除活动')}
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
