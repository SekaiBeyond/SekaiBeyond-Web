import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    API_SCOPES,
    type ApiKeySummary,
    type ApiScope,
    callCreateApiKey,
    callListApiKeys,
    callRenameApiKey,
    callRevokeApiKey,
    SELLER_ID_RE,
} from '~/lib/firebase';
import { localized } from '~/lib/localized';
import { usePastEvents } from '~/lib/pastEvents';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { CreateSection } from '../CrudShell';
import type { ShowToast } from '../utils';

interface ApiKeysToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

const SCOPE_LABELS: Record<ApiScope, {en: string; zh: string; descEn: string; descZh: string}> = {
    'events:read': {
        en: 'Read events', zh: '读取活动',
        descEn: 'List every event, archived ones included, and look one up.',
        descZh: '列出所有活动（包括已归档的活动），并查询单个活动。',
    },
    'tickets:write': {
        en: 'Sell tickets', zh: '售票',
        descEn: 'Issue tickets for an order once it\'s paid.',
        descZh: '在订单付款后签发门票。',
    },
    'tickets:read': {
        en: 'Read orders', zh: '查询订单',
        descEn: 'Look up an order\'s tickets and whether each has been used.',
        descZh: '查询订单中的门票及每张是否已使用。',
    },
};

const EXPIRY_OPTIONS = [30, 90, 365, 730];
const DEFAULT_EXPIRY_DAYS = 365;

const isExpired = (k: ApiKeySummary, now: number): boolean =>
    !!k.expiresAt && Date.parse(k.expiresAt) <= now;

export const ApiKeysTool = ({onBack, showToast}: ApiKeysToolProps) => {
    const {isEnglish} = useLanguage();
    const {upcomingEvents} = useAllUpcomingEvents();
    // A key held to an event keeps it once the event is archived.
    const {pastEvents} = usePastEvents();

    const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
    const [serverNow, setServerNow] = useState(() => Date.now());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    // One key renamed at a time, in place of its name.
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [savingRename, setSavingRename] = useState(false);

    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
    const [seller, setSeller] = useState('');
    const [scopes, setScopes] = useState<ApiScope[]>([...API_SCOPES]);
    const [allEvents, setAllEvents] = useState(true);
    const [eventIds, setEventIds] = useState<string[]>([]);
    const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
    const [creating, setCreating] = useState(false);
    // The new key, shown this once: only its hash is kept.
    const [created, setCreated] = useState<{name: string; key: string} | null>(null);

    const load = useCallback(async (notify: boolean) => {
        setLoading(true);
        try {
            const res = await callListApiKeys();
            setKeys(res.data.keys);
            setServerNow(Date.parse(res.data.serverNow) || Date.now());
            setError(false);
            if (notify) showToast(isEnglish ? 'API keys refreshed.' : 'API 密钥已刷新。', 'success');
        } catch (err) {
            console.error('[ApiKeysTool] load', err);
            setError(true);
            if (notify) showToast(isEnglish ? 'Could not load API keys.' : '无法加载 API 密钥。', 'error');
        } finally {
            setLoading(false);
        }
    }, [isEnglish, showToast]);

    useEffect(() => {
        // On mount only; refresh is manual, and a language toggle shouldn't refetch.
        void load(false);
    }, []);

    const resetForm = () => {
        setName('');
        setSeller('');
        setScopes([...API_SCOPES]);
        setAllEvents(true);
        setEventIds([]);
        setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    };

    const toggleScope = (scope: ApiScope) =>
        setScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

    const toggleEvent = (eventId: string) =>
        setEventIds(prev => prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]);

    const canCreate = !!name.trim() && SELLER_ID_RE.test(seller) && scopes.length > 0
        && (allEvents || eventIds.length > 0);

    const createKey = async () => {
        if (!canCreate) return;
        setCreating(true);
        try {
            const res = await callCreateApiKey({
                name: name.trim(),
                seller,
                scopes,
                eventIds: allEvents ? [] : eventIds,
                expiresInDays,
            });
            setCreated({name: name.trim(), key: res.data.key});
            setShowCreate(false);
            resetForm();
            void load(false);
        } catch (err) {
            console.error('[ApiKeysTool] create', err);
            showToast(isEnglish ? 'Failed to create API key.' : '创建 API 密钥失败。', 'error');
        } finally {
            setCreating(false);
        }
    };

    const copyKey = async () => {
        if (!created) return;
        try {
            await navigator.clipboard.writeText(created.key);
            showToast(isEnglish ? 'Key copied.' : '密钥已复制。', 'success');
        } catch {
            showToast(isEnglish ? 'Couldn\'t copy. Select the key and copy it by hand.' : '复制失败，请手动选择并复制密钥。',
                'error');
        }
    };

    const startRename = (k: ApiKeySummary) => {
        setRenamingId(k.id);
        setRenameDraft(k.name);
    };

    const saveRename = async (k: ApiKeySummary) => {
        const newName = renameDraft.trim();
        if (!newName) return;
        if (newName === k.name) {
            setRenamingId(null);
            return;
        }
        setSavingRename(true);
        try {
            const res = await callRenameApiKey({keyId: k.id, name: newName});
            setKeys(prev => prev?.map(p => p.id === k.id ? {...p, name: res.data.name} : p) ?? prev);
            setRenamingId(null);
            showToast(isEnglish ? 'API key renamed.' : 'API 密钥已重命名。', 'success');
        } catch (err) {
            console.error('[ApiKeysTool] rename', err);
            showToast(isEnglish ? 'Failed to rename API key.' : '重命名 API 密钥失败。', 'error');
        } finally {
            setSavingRename(false);
        }
    };

    // Revoking deletes the key. An expired one, which no longer works, is only
    // deleted.
    const revokeKey = async (k: ApiKeySummary, active: boolean) => {
        if (!confirm(active
            ? (isEnglish
                ? `Revoke "${k.name}"? Anything using it stops working at once, and the key is deleted. This can't be undone.`
                : `吊销"${k.name}"？所有使用此密钥的服务将立即失效，密钥也将被删除，且无法撤销。`)
            : (isEnglish
                ? `Delete "${k.name}"? It no longer works, and it will be removed from this list.`
                : `删除"${k.name}"？此密钥已失效，删除后将从列表中移除。`)
        )) return;
        setRevokingId(k.id);
        try {
            await callRevokeApiKey({keyId: k.id});
            showToast(active
                ? (isEnglish ? 'API key revoked and deleted.' : 'API 密钥已吊销并删除。')
                : (isEnglish ? 'API key deleted.' : 'API 密钥已删除。'), 'warning');
            await load(false);
        } catch (err) {
            console.error('[ApiKeysTool] revoke', err);
            showToast(active
                ? (isEnglish ? 'Failed to revoke API key.' : '吊销 API 密钥失败。')
                : (isEnglish ? 'Failed to delete API key.' : '删除 API 密钥失败。'), 'error');
        } finally {
            setRevokingId(null);
        }
    };

    const fmtDate = (iso: string | null) => iso
        ? new Date(iso).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
        : '';
    const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const eventTitle = (eventId: string) => {
        const event = upcomingEvents.find(e => e.id === eventId) ?? pastEvents.find(e => e.id === eventId);
        return event ? localized(isEnglish, event.title, event.titleCn) : eventId;
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'API Keys' : 'API 密钥'}</h3>
                <button
                    className="admin-toggle-btn admin-toggle-edit admin-quota-refresh"
                    onClick={() => void load(true)}
                    disabled={loading}
                    type="button"
                >
                    {loading ? (isEnglish ? 'Loading...' : '加载中...') : (isEnglish ? 'Refresh' : '刷新')}
                </button>
            </div>

            <p className="admin-helper-text admin-section-mb">
                {isEnglish
                    ? 'A key gives a server admin-level access to the ticket API: it reads every event, unpublished ones included, and sells tickets for paid ones, which land on the event\'s list and scan at the door like any other. Give keys only to our own systems and partners\' servers we trust, never put one inside an app, and revoke it if it leaks.'
                    : '密钥可让服务器以管理员级别访问门票 API：可读取所有活动（包括未发布的活动），并为付费活动售票；所售门票会出现在活动名单中，并可像其他门票一样在现场扫描。密钥只能交给我们自己的系统和可信合作方的服务器，切勿放进应用内；如有泄露请立即吊销。'}
            </p>

            {created && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-warning admin-api-key-created">
                    <p>
                        {isEnglish
                            ? <>Here's the key for <strong>{created.name}</strong>. Copy it now: this is the only time
                                it's shown.</>
                            : <><strong>{created.name}</strong> 的密钥如下。请立即复制：此后将不再显示。</>}
                    </p>
                    <div className="admin-api-key-reveal">
                        <input
                            className="admin-input"
                            value={created.key}
                            readOnly
                            onFocus={e => e.target.select()}
                            aria-label={isEnglish ? 'New API key' : '新 API 密钥'}
                        />
                        <button className="admin-toggle-btn admin-toggle-edit" onClick={() => void copyKey()}
                                type="button">
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={() => setCreated(null)}
                                type="button">
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </div>
                </div>
            )}

            <CreateSection
                show={showCreate}
                setShow={setShowCreate}
                newLabel={isEnglish ? '+ New API Key' : '+ 新建 API 密钥'}
                title={isEnglish ? 'Create API Key' : '创建 API 密钥'}
                ctaLabel={isEnglish ? 'Create Key' : '创建密钥'}
                ctaBusyLabel={isEnglish ? 'Creating...' : '创建中...'}
                busy={creating}
                ctaDisabled={!canCreate}
                onCreate={() => void createKey()}
                onCancel={resetForm}
            >
                <div className="admin-api-key-form">
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name' : '名称'}</span>
                        <input
                            className="admin-input"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={isEnglish ? 'e.g. Chinese ticket app' : '例如：中文售票应用'}
                            maxLength={60}
                            disabled={creating}
                        />
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Seller ID' : '卖家 ID'}</span>
                        <input
                            className="admin-input"
                            value={seller}
                            onChange={e => setSeller(e.target.value.trim().toLowerCase())}
                            placeholder={isEnglish ? 'e.g. cn-app' : '例如：cn-app'}
                            maxLength={32}
                            list="api-key-sellers"
                            disabled={creating}
                        />
                        <datalist id="api-key-sellers">
                            {[...new Set(keys?.map(k => k.seller).filter(Boolean))].map(s => <option key={s}
                                                                                                     value={s}/>)}
                        </datalist>
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'Order numbers are kept per seller, so two apps can both have an order 1001. Give each app its own ID, and a key that replaces another the same one, or it won\'t find the orders placed before. Lowercase letters, digits and -.'
                                : '订单号按卖家区分，因此两个应用可以各有一个 1001 号订单。每个应用使用各自的 ID；替换旧密钥的新密钥须使用相同 ID，否则查不到此前的订单。仅限小写字母、数字和 -。'}
                        </span>
                    </label>

                    <fieldset className="admin-api-key-fieldset" disabled={creating}>
                        <legend>{isEnglish ? 'What it may do' : '权限'}</legend>
                        {API_SCOPES.map(scope => (
                            <label key={scope} className="admin-checkbox-label admin-api-key-option">
                                <input type="checkbox" checked={scopes.includes(scope)}
                                       onChange={() => toggleScope(scope)}/>
                                <span>
                                    <strong>{isEnglish ? SCOPE_LABELS[scope].en : SCOPE_LABELS[scope].zh}</strong>
                                    {' '}<code className="record-code">{scope}</code>
                                    <span className="admin-helper-text admin-api-key-option-desc">
                                        {isEnglish ? SCOPE_LABELS[scope].descEn : SCOPE_LABELS[scope].descZh}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </fieldset>

                    <fieldset className="admin-api-key-fieldset" disabled={creating}>
                        <legend>{isEnglish ? 'Events' : '活动'}</legend>
                        <label className="admin-checkbox-label">
                            <input type="radio" name="api-key-events" checked={allEvents}
                                   onChange={() => setAllEvents(true)}/>
                            <span>{isEnglish ? 'Every event' : '所有活动'}</span>
                        </label>
                        <label className="admin-checkbox-label">
                            <input type="radio" name="api-key-events" checked={!allEvents}
                                   onChange={() => setAllEvents(false)}/>
                            <span>{isEnglish ? 'Only these events' : '仅限以下活动'}</span>
                        </label>
                        {!allEvents && (
                            upcomingEvents.length === 0 ? (
                                <p className="admin-helper-text">
                                    {isEnglish ? 'There are no upcoming events yet.' : '暂无即将举行的活动。'}
                                </p>
                            ) : (
                                <div className="admin-api-key-events">
                                    {upcomingEvents.map(e => (
                                        <label key={e.id} className="admin-checkbox-label">
                                            <input type="checkbox" checked={eventIds.includes(e.id)}
                                                   onChange={() => toggleEvent(e.id)}/>
                                            <span>{eventTitle(e.id)}</span>
                                        </label>
                                    ))}
                                </div>
                            )
                        )}
                    </fieldset>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Expires after' : '有效期'}</span>
                        <select
                            className="admin-input"
                            value={expiresInDays}
                            onChange={e => setExpiresInDays(Number(e.target.value))}
                            disabled={creating}
                        >
                            {EXPIRY_OPTIONS.map(days => (
                                <option key={days} value={days}>
                                    {days >= 365
                                        ? (isEnglish ? `${days / 365} year${days === 365 ? '' : 's'}` : `${days / 365} 年`)
                                        : (isEnglish ? `${days} days` : `${days} 天`)}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </CreateSection>

            {error && !keys && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-error">
                    <span>{isEnglish ? 'Could not load API keys. Try refreshing.' : '无法加载 API 密钥，请尝试刷新。'}</span>
                </div>
            )}

            {!keys && loading && <div className="spinner spinner-centered"/>}

            {keys && keys.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No API keys yet.' : '暂无 API 密钥。'}</p>
            )}

            {keys && keys.length > 0 && (
                <div className="admin-api-key-list">
                    {keys.map(k => {
                        const expired = isExpired(k, serverNow);
                        const renaming = renamingId === k.id;
                        return (
                            <div key={k.id}
                                 className={`admin-api-key-card${expired ? ' admin-api-key-card--inactive' : ''}`}>
                                <div className="admin-api-key-head">
                                    {renaming ? (
                                        <form
                                            className="admin-api-key-rename"
                                            onSubmit={e => {
                                                e.preventDefault();
                                                void saveRename(k);
                                            }}
                                        >
                                            <input
                                                className="admin-input admin-input--sm"
                                                value={renameDraft}
                                                onChange={e => setRenameDraft(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Escape' && !savingRename) setRenamingId(null);
                                                }}
                                                maxLength={60}
                                                disabled={savingRename}
                                                autoFocus
                                                aria-label={isEnglish ? 'Key name' : '密钥名称'}
                                            />
                                            <button
                                                className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                                                disabled={savingRename || !renameDraft.trim()}
                                                type="submit"
                                            >
                                                {savingRename
                                                    ? (isEnglish ? 'Saving...' : '保存中...')
                                                    : (isEnglish ? 'Save' : '保存')}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                                                onClick={() => setRenamingId(null)}
                                                disabled={savingRename}
                                                type="button"
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </form>
                                    ) : (
                                        <span className="admin-api-key-name">{k.name}</span>
                                    )}
                                    <code className="record-code">{k.hint}</code>
                                    <span
                                        className={`admin-tickets-tag ${expired ? 'admin-tickets-tag-unlinked' : 'admin-tickets-tag-fresh'}`}>
                                        {expired
                                            ? (isEnglish ? 'Expired' : '已过期')
                                            : (isEnglish ? 'Active' : '有效')}
                                    </span>
                                    {!renaming && (
                                        <div className="admin-api-key-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => startRename(k)}
                                                disabled={revokingId === k.id}
                                                type="button"
                                            >
                                                {isEnglish ? 'Rename' : '重命名'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                                onClick={() => void revokeKey(k, !expired)}
                                                disabled={revokingId === k.id}
                                                type="button"
                                            >
                                                {!expired
                                                    ? (revokingId === k.id
                                                        ? (isEnglish ? 'Revoking...' : '吊销中...')
                                                        : (isEnglish ? 'Revoke' : '吊销'))
                                                    : (revokingId === k.id
                                                        ? (isEnglish ? 'Deleting...' : '删除中...')
                                                        : (isEnglish ? 'Delete' : '删除'))}
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="admin-api-key-tags">
                                    {k.scopes.map(scope => (
                                        <span key={scope} className="admin-tickets-tag admin-tickets-tag-used">
                                            {isEnglish ? SCOPE_LABELS[scope]?.en ?? scope : SCOPE_LABELS[scope]?.zh ?? scope}
                                        </span>
                                    ))}
                                </div>
                                <div className="admin-api-key-meta">
                                    {k.seller && (
                                        <span>
                                            {isEnglish ? 'Seller ' : '卖家 '}<code
                                            className="record-code">{k.seller}</code>
                                        </span>
                                    )}
                                    <span>
                                        {k.eventIds.length === 0
                                            ? (isEnglish ? 'Every event' : '所有活动')
                                            : `${isEnglish ? 'Only' : '仅限'} ${k.eventIds.map(eventTitle).join(isEnglish ? ', ' : '、')}`}
                                    </span>
                                    <span>
                                        {isEnglish
                                            ? `Created ${fmtDate(k.createdAt)}${k.createdByName ? ` by ${k.createdByName}` : ''}`
                                            : `${k.createdByName ? `${k.createdByName} ` : ''}创建于 ${fmtDate(k.createdAt)}`}
                                    </span>
                                    <span>
                                        {expired
                                            ? (isEnglish ? `Expired ${fmtDate(k.expiresAt)}` : `已于 ${fmtDate(k.expiresAt)} 过期`)
                                            : (isEnglish ? `Expires ${fmtDate(k.expiresAt)}` : `${fmtDate(k.expiresAt)} 过期`)}
                                    </span>
                                    <span>
                                        {k.lastUsedAt
                                            ? (isEnglish ? `Last used ${fmtDateTime(k.lastUsedAt)}` : `最近使用于 ${fmtDateTime(k.lastUsedAt)}`)
                                            : (isEnglish ? 'Never used' : '从未使用')}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
