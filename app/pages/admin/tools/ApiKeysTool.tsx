import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    API_SCOPES,
    type ApiKeySummary,
    type ApiScope,
    callCreateApiKey,
    callListApiKeys,
    callRevokeApiKey,
} from '~/lib/firebase';
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

type KeyStatus = 'active' | 'expired' | 'revoked';

const keyStatus = (k: ApiKeySummary, now: number): KeyStatus =>
    k.revokedAt ? 'revoked'
        : k.expiresAt && Date.parse(k.expiresAt) <= now ? 'expired'
            : 'active';

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

    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
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
        setScopes([...API_SCOPES]);
        setAllEvents(true);
        setEventIds([]);
        setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    };

    const toggleScope = (scope: ApiScope) =>
        setScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

    const toggleEvent = (eventId: string) =>
        setEventIds(prev => prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]);

    const createKey = async () => {
        if (!name.trim() || scopes.length === 0 || (!allEvents && eventIds.length === 0)) return;
        setCreating(true);
        try {
            const res = await callCreateApiKey({
                name: name.trim(),
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

    // Revoking deletes the key. One that no longer works (expired, or revoked
    // before revoking deleted) is only deleted.
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
        ? new Date(iso).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {year: 'numeric', month: 'short', day: 'numeric'})
        : '';
    const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const eventTitle = (eventId: string) => {
        const event = upcomingEvents.find(e => e.id === eventId) ?? pastEvents.find(e => e.id === eventId);
        if (!event) return eventId;
        return (isEnglish ? event.title : event.titleCn) || event.title;
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
                            ? <>Here's the key for <strong>{created.name}</strong>. Copy it now: this is the only time it's shown.</>
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
                        <button className="admin-toggle-btn admin-toggle-edit" onClick={() => void copyKey()} type="button">
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={() => setCreated(null)} type="button">
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
                ctaDisabled={!name.trim() || scopes.length === 0 || (!allEvents && eventIds.length === 0)}
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

                    <fieldset className="admin-api-key-fieldset" disabled={creating}>
                        <legend>{isEnglish ? 'What it may do' : '权限'}</legend>
                        {API_SCOPES.map(scope => (
                            <label key={scope} className="admin-checkbox-label admin-api-key-option">
                                <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)}/>
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
                            <input type="radio" name="api-key-events" checked={allEvents} onChange={() => setAllEvents(true)}/>
                            <span>{isEnglish ? 'Every event' : '所有活动'}</span>
                        </label>
                        <label className="admin-checkbox-label">
                            <input type="radio" name="api-key-events" checked={!allEvents} onChange={() => setAllEvents(false)}/>
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
                                            <input type="checkbox" checked={eventIds.includes(e.id)} onChange={() => toggleEvent(e.id)}/>
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
                        const status = keyStatus(k, serverNow);
                        return (
                            <div key={k.id} className={`admin-api-key-card${status === 'active' ? '' : ' admin-api-key-card--inactive'}`}>
                                <div className="admin-api-key-head">
                                    <span className="admin-api-key-name">{k.name}</span>
                                    <code className="record-code">{k.hint}</code>
                                    <span className={`admin-tickets-tag ${status === 'active'
                                        ? 'admin-tickets-tag-fresh'
                                        : status === 'revoked' ? 'admin-tickets-tag-voided' : 'admin-tickets-tag-unlinked'}`}>
                                        {status === 'active'
                                            ? (isEnglish ? 'Active' : '有效')
                                            : status === 'revoked'
                                                ? (isEnglish ? 'Revoked' : '已吊销')
                                                : (isEnglish ? 'Expired' : '已过期')}
                                    </span>
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke admin-btn-sm admin-api-key-revoke"
                                        onClick={() => void revokeKey(k, status === 'active')}
                                        disabled={revokingId === k.id}
                                        type="button"
                                    >
                                        {status === 'active'
                                            ? (revokingId === k.id
                                                ? (isEnglish ? 'Revoking...' : '吊销中...')
                                                : (isEnglish ? 'Revoke' : '吊销'))
                                            : (revokingId === k.id
                                                ? (isEnglish ? 'Deleting...' : '删除中...')
                                                : (isEnglish ? 'Delete' : '删除'))}
                                    </button>
                                </div>
                                <div className="admin-api-key-tags">
                                    {k.scopes.map(scope => (
                                        <span key={scope} className="admin-tickets-tag admin-tickets-tag-used">
                                            {isEnglish ? SCOPE_LABELS[scope]?.en ?? scope : SCOPE_LABELS[scope]?.zh ?? scope}
                                        </span>
                                    ))}
                                </div>
                                <div className="admin-api-key-meta">
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
                                    {status === 'revoked' ? (
                                        <span>
                                            {isEnglish
                                                ? `Revoked ${fmtDate(k.revokedAt)}${k.revokedByName ? ` by ${k.revokedByName}` : ''}`
                                                : `${k.revokedByName ? `${k.revokedByName} ` : ''}吊销于 ${fmtDate(k.revokedAt)}`}
                                        </span>
                                    ) : (
                                        <span>
                                            {status === 'expired'
                                                ? (isEnglish ? `Expired ${fmtDate(k.expiresAt)}` : `已于 ${fmtDate(k.expiresAt)} 过期`)
                                                : (isEnglish ? `Expires ${fmtDate(k.expiresAt)}` : `${fmtDate(k.expiresAt)} 过期`)}
                                        </span>
                                    )}
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
