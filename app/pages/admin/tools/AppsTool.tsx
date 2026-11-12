import { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    API_SCOPES,
    type ApiKeySummary,
    type ApiScope,
    APP_ID_RE,
    APP_SCOPES,
    type AppScope,
    type AppSummary,
    callCreateApiKey,
    callDeleteApp,
    callListApps,
    callRenameApiKey,
    callRevokeApiKey,
    callSaveApp,
    functionsErrorCode,
} from '~/lib/firebase';
import { localized } from '~/lib/localized';
import { usePastEvents } from '~/lib/pastEvents';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { CreateSection } from '../CrudShell';
import { UserSearchAdd } from '../UserSearchAdd';
import type { ShowToast } from '../utils';

interface AppsToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

const APP_SCOPE_LABELS: Record<AppScope, {en: string; zh: string; descEn: string; descZh: string}> = {
    'events:read': {
        en: 'Read events', zh: '读取活动',
        descEn: 'The events the person signed in can see here: published ones, and unpublished ones too if they\'re staff or that event\'s staff.',
        descZh: '登录者在本站可以查看的活动：已发布的活动；如果登录者是工作人员或该活动的工作人员，也包括未发布的活动。',
    },
    'team:read': {
        en: 'Read the team', zh: '读取团队',
        descEn: 'Staff and above, with names, photos, groups and titles, if the person signed in is staff.',
        descZh: '工作人员及以上成员的名称、头像、组别和头衔（仅限登录者为工作人员时）。',
    },
    'event-staff:read': {
        en: 'Read event staff', zh: '读取活动工作人员',
        descEn: 'Which events the person signed in is staff for, on their sign-in and from /v1/me; and an event\'s staff, if the person signed in is staff, or staff of that event.',
        descZh: '登录者担任工作人员的活动（写在其登录凭证中，也可从 /v1/me 读取）；以及某个活动的工作人员名单（仅限登录者为工作人员或该活动的工作人员时）。',
    },
};

const KEY_SCOPE_LABELS: Record<ApiScope, {en: string; zh: string; descEn: string; descZh: string}> = {
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
const DAY_MS = 24 * 60 * 60 * 1000;

const isExpired = (k: ApiKeySummary, now: number): boolean =>
    !!k.expiresAt && Date.parse(k.expiresAt) <= now;

/** The expiry option a key was made with, or the default when it matches none. */
const lifetimeOption = (k: ApiKeySummary): number => {
    if (!k.createdAt || !k.expiresAt) return DEFAULT_EXPIRY_DAYS;
    const days = Math.round((Date.parse(k.expiresAt) - Date.parse(k.createdAt)) / DAY_MS);
    return EXPIRY_OPTIONS.includes(days) ? days : DEFAULT_EXPIRY_DAYS;
};

interface Draft {
    appId: string;
    name: string;
    owner: {uid: string; name: string} | null;
    signIn: boolean;
    redirectUris: string;
    scopes: AppScope[];
    firebaseProjectId: string;
    serviceAccount: string;
}

const EMPTY_DRAFT: Draft = {
    appId: '',
    name: '',
    owner: null,
    signIn: true,
    redirectUris: '',
    scopes: [],
    firebaseProjectId: '',
    serviceAccount: '',
};

const redirectLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

/**
 * Apps (functions/src/utils/apps.ts) and their server API keys
 * (functions/src/utils/apiKeys.ts): registering an app gives it an ID, an
 * optional owner, optional sign-in with accounts here, and server-to-server
 * keys for the ticket API under that app.
 */
export const AppsTool = ({onBack, showToast}: AppsToolProps) => {
    const {isEnglish} = useLanguage();
    const {upcomingEvents} = useAllUpcomingEvents();
    // A key held to an event keeps it once the event is archived.
    const {pastEvents} = usePastEvents();

    const [apps, setApps] = useState<AppSummary[] | null>(null);
    const [signer, setSigner] = useState('');
    const [serverNow, setServerNow] = useState(() => Date.now());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const [showForm, setShowForm] = useState(false);
    // The app being changed, or null for a new one.
    const [editing, setEditing] = useState<AppSummary | null>(null);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const formRef = useRef<HTMLDivElement>(null);

    // Per-app API key creation / re-creation.
    const [keyAppId, setKeyAppId] = useState<string | null>(null);
    const [keyName, setKeyName] = useState('');
    const [keyScopes, setKeyScopes] = useState<ApiScope[]>([...API_SCOPES]);
    const [allEvents, setAllEvents] = useState(true);
    const [eventIds, setEventIds] = useState<string[]>([]);
    const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
    const [creatingKey, setCreatingKey] = useState(false);
    const [recreatingKey, setRecreatingKey] = useState<ApiKeySummary | null>(null);
    // The new key, shown this once: only its hash is kept.
    const [created, setCreated] = useState<{name: string; appName: string; key: string} | null>(null);
    const createdRef = useRef<HTMLDivElement>(null);

    // One key renamed or revoked at a time.
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [savingRename, setSavingRename] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const load = useCallback(async (notify: boolean) => {
        setLoading(true);
        try {
            const res = await callListApps();
            setApps(res.data.apps);
            setSigner(res.data.signer);
            setServerNow(Date.parse(res.data.serverNow) || Date.now());
            setError(false);
            if (notify) showToast(isEnglish ? 'Apps refreshed.' : '应用已刷新。', 'success');
        } catch (err) {
            console.error('[AppsTool] load', err);
            setError(true);
            if (notify) showToast(isEnglish ? 'Could not load apps.' : '无法加载应用。', 'error');
        } finally {
            setLoading(false);
        }
    }, [isEnglish, showToast]);

    useEffect(() => {
        // On mount only; refresh is manual, and a language toggle shouldn't refetch.
        void load(false);
    }, []);

    useEffect(() => {
        if (editing) formRef.current?.scrollIntoView({block: 'start', behavior: 'smooth'});
    }, [editing]);

    useEffect(() => {
        if (created) createdRef.current?.scrollIntoView({block: 'start', behavior: 'smooth'});
    }, [created]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({...prev, [key]: value}));

    const resetForm = () => {
        setDraft(EMPTY_DRAFT);
        setEditing(null);
    };

    const startEdit = (app: AppSummary) => {
        setDraft({
            appId: app.id,
            name: app.name,
            owner: app.ownerUid ? {uid: app.ownerUid, name: app.ownerName} : null,
            signIn: app.redirectUris.length > 0,
            redirectUris: app.redirectUris.join('\n'),
            scopes: APP_SCOPES.filter(s => app.scopes.includes(s)),
            firebaseProjectId: app.firebaseProjectId,
            serviceAccount: app.serviceAccount,
        });
        setEditing(app);
        setShowForm(true);
    };

    const toggleScope = (scope: AppScope) =>
        set('scopes', draft.scopes.includes(scope) ? draft.scopes.filter(s => s !== scope) : [...draft.scopes, scope]);

    const canSave = APP_ID_RE.test(draft.appId) && !!draft.name.trim() && (
        !draft.signIn || (
            redirectLines(draft.redirectUris).length > 0
            && !!draft.firebaseProjectId.trim()
            && !!draft.serviceAccount.trim()
        )
    );

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await callSaveApp({
                appId: draft.appId,
                create: !editing,
                name: draft.name.trim(),
                ownerUid: draft.owner?.uid ?? '',
                redirectUris: draft.signIn ? redirectLines(draft.redirectUris) : [],
                scopes: draft.signIn ? draft.scopes : [],
                firebaseProjectId: draft.signIn ? draft.firebaseProjectId.trim() : '',
                serviceAccount: draft.signIn ? draft.serviceAccount.trim() : '',
            });
            showToast(editing
                ? (isEnglish ? 'App saved.' : '应用已保存。')
                : (isEnglish ? 'App registered.' : '应用已登记。'), 'success');
            setShowForm(false);
            resetForm();
            void load(false);
        } catch (err) {
            console.error('[AppsTool] save', err);
            const code = functionsErrorCode(err);
            const message = (err as {message?: string})?.message ?? '';
            showToast(code === 'app-exists'
                ? (isEnglish ? 'An app with this ID already exists.' : '已存在使用此 ID 的应用。')
                : code === 'owner-not-found'
                    ? (isEnglish ? 'That owner\'s account no longer exists.' : '该负责人的账号已不存在。')
                    : (isEnglish ? `Failed to save the app. ${message}` : `保存应用失败。${message}`), 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (app: AppSummary) => {
        if (!confirm(isEnglish
            ? `Remove "${app.name}"? Nobody can sign in to it with their account here any more, its API keys are revoked, and the API stops answering it within seconds. Its own data stays with it.`
            : `移除"${app.name}"？此后将无法再用本站账号登录该应用，其 API 密钥也将被吊销，API 会在几秒内停止响应它。该应用自己的数据不受影响。`)) return;
        setDeletingId(app.id);
        try {
            await callDeleteApp({appId: app.id});
            if (keyAppId === app.id) resetKeyForm();
            showToast(isEnglish ? 'App removed.' : '应用已移除。', 'warning');
            await load(false);
        } catch (err) {
            console.error('[AppsTool] delete', err);
            showToast(isEnglish ? 'Failed to remove the app.' : '移除应用失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const resetKeyForm = () => {
        setKeyAppId(null);
        setKeyName('');
        setKeyScopes([...API_SCOPES]);
        setAllEvents(true);
        setEventIds([]);
        setExpiresInDays(DEFAULT_EXPIRY_DAYS);
        setRecreatingKey(null);
    };

    const startNewKey = (app: AppSummary) => {
        setKeyAppId(app.id);
        setKeyName('');
        setKeyScopes([...API_SCOPES]);
        setAllEvents(true);
        setEventIds([]);
        setExpiresInDays(DEFAULT_EXPIRY_DAYS);
        setRecreatingKey(null);
    };

    // A key itself isn't kept, so re-creating one makes a new key with its
    // settings under the same app (so it still finds orders placed before).
    const startRecreateKey = (k: ApiKeySummary) => {
        setKeyAppId(k.appId);
        setKeyName(k.name);
        setKeyScopes(API_SCOPES.filter(s => k.scopes.includes(s)));
        setAllEvents(k.eventIds.length === 0);
        setEventIds(k.eventIds);
        setExpiresInDays(lifetimeOption(k));
        setRecreatingKey(k);
    };

    const toggleKeyScope = (scope: ApiScope) =>
        setKeyScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

    const toggleEvent = (eventId: string) =>
        setEventIds(prev => prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]);

    const canCreateKey = !!keyAppId && !!keyName.trim() && keyScopes.length > 0 && (allEvents || eventIds.length > 0);

    const createKey = async (app: AppSummary) => {
        if (!canCreateKey || keyAppId !== app.id) return;
        setCreatingKey(true);
        try {
            const res = await callCreateApiKey({
                appId: app.id,
                name: keyName.trim(),
                scopes: keyScopes,
                eventIds: allEvents ? [] : eventIds,
                expiresInDays,
            });
            setCreated({name: keyName.trim(), appName: app.name, key: res.data.key});
            resetKeyForm();
            void load(false);
        } catch (err) {
            console.error('[AppsTool] createKey', err);
            const code = functionsErrorCode(err);
            const missingEvent = code === 'event-not-found'
                || (err instanceof FirebaseError && err.code === 'functions/not-found');
            showToast(missingEvent
                ? (isEnglish ? 'One of the events no longer exists. Untick it and try again.' : '其中一个活动已不存在，请取消勾选后重试。')
                : (isEnglish ? 'Failed to create API key.' : '创建 API 密钥失败。'), 'error');
        } finally {
            setCreatingKey(false);
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

    const startRenameKey = (k: ApiKeySummary) => {
        setRenamingId(k.id);
        setRenameDraft(k.name);
    };

    const saveRenameKey = async (k: ApiKeySummary) => {
        const newName = renameDraft.trim();
        if (!newName) return;
        if (newName === k.name) {
            setRenamingId(null);
            return;
        }
        setSavingRename(true);
        try {
            const res = await callRenameApiKey({keyId: k.id, name: newName});
            setApps(prev => prev?.map(a => a.id === k.appId
                ? {...a, keys: a.keys.map(p => p.id === k.id ? {...p, name: res.data.name} : p)}
                : a) ?? prev);
            setRenamingId(null);
            showToast(isEnglish ? 'API key renamed.' : 'API 密钥已重命名。', 'success');
        } catch (err) {
            console.error('[AppsTool] renameKey', err);
            showToast(isEnglish ? 'Failed to rename API key.' : '重命名 API 密钥失败。', 'error');
        } finally {
            setSavingRename(false);
        }
    };

    const revokeKey = async (k: ApiKeySummary, active: boolean) => {
        if (!confirm(active
            ? (isEnglish
                ? `Revoke "${k.name}"? Anything using it stops working at once, and the key is deleted. This can't be undone.`
                : `吊销"${k.name}"？所有使用此密钥的服务将立即失效，密钥也将被删除，且无法撤销。`)
            : (isEnglish
                ? `Delete
                        "${k.name}"? It no longer works, and it will be removed from this list.`
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
            console.error('[AppsTool] revokeKey', err);
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
    const pickableEventIds = [
        ...upcomingEvents.map(e => e.id),
        ...(recreatingKey?.eventIds ?? []).filter(id => !upcomingEvents.some(e => e.id === id)),
    ];

    // What the app's owner runs once, on their project, so its sign-ins can be made here.
    const grants = (app: AppSummary) => signer ? [
        `gcloud iam service-accounts add-iam-policy-binding ${app.serviceAccount} --member="serviceAccount:${signer}" --role="roles/iam.serviceAccountTokenCreator" --project=${app.firebaseProjectId}`,
        `gcloud projects add-iam-policy-binding ${app.firebaseProjectId} --member="serviceAccount:${signer}" --role="roles/firebaseauth.admin"`,
    ] : [];

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Apps' : '应用'}</h3>
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
                    ? 'Apps are our own projects and trusted partners\' systems, like SKBY Manager or a ticket seller. People can sign in to an app with their account here, and its server can hold API keys for the ticket API. Who may do what in the app, and its own data, are up to its owner.'
                    : '应用是我们自己的项目或可信合作方的系统（例如 SKBY Manager 或售票应用）。用户可以用本站账号登录应用，其服务器也可持有门票 API 的密钥。应用内谁能做什么、以及应用自己的数据，都由应用负责人决定。'}
            </p>

            <div ref={createdRef}/>
            {created && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-warning admin-api-key-created">
                    <p>
                        {isEnglish
                            ? <>Here's the key <strong>{created.name}</strong> for <strong>{created.appName}</strong>.
                                Copy it now: this is the only time it's shown.</>
                            : <>
                                <strong>{created.appName}</strong> 的密钥 <strong>{created.name}</strong> 如下。请立即复制：此后将不再显示。</>}
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

            <div ref={formRef}/>
            <CreateSection
                show={showForm}
                setShow={setShowForm}
                newLabel={isEnglish ? '+ Register App' : '+ 登记应用'}
                title={editing ? (isEnglish ? `Edit ${editing.name}` : `编辑 ${editing.name}`) : (isEnglish ? 'Register App' : '登记应用')}
                ctaLabel={editing ? (isEnglish ? 'Save' : '保存') : (isEnglish ? 'Register' : '登记')}
                ctaBusyLabel={isEnglish ? 'Saving...' : '保存中...'}
                busy={saving}
                ctaDisabled={!canSave}
                onCreate={() => void save()}
                onCancel={resetForm}
            >
                <div className="admin-api-key-form">
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'App ID' : '应用 ID'}</span>
                        <input
                            className="admin-input"
                            value={draft.appId}
                            onChange={e => set('appId', e.target.value.trim().toLowerCase())}
                            placeholder="skby-manager"
                            maxLength={32}
                            disabled={saving || !!editing}
                        />
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'Used in sign-in links and to keep this app\'s ticket orders separate from other apps\', so it can\'t change. Lowercase letters, digits and -.'
                                : '用于登录链接，并用于将该应用的门票订单与其他应用区分开，因此无法更改。仅限小写字母、数字和 -。'}
                        </span>
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name' : '名称'}</span>
                        <input
                            className="admin-input"
                            value={draft.name}
                            onChange={e => set('name', e.target.value)}
                            placeholder="SKBY Manager"
                            maxLength={60}
                            disabled={saving}
                        />
                        <span className="admin-helper-text">
                            {isEnglish ? 'Shown on this list and when people sign in to it.' : '在此列表中显示，并在用户登录时向用户显示。'}
                        </span>
                    </label>

                    <div className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Owner' : '负责人'}</span>
                        {draft.owner ? (
                            <div className="admin-btn-row">
                                <strong>{draft.owner.name || draft.owner.uid}</strong>
                                <button className="admin-toggle-btn admin-toggle-cancel admin-btn-sm" type="button"
                                        onClick={() => set('owner', null)} disabled={saving}>
                                    {isEnglish ? 'Remove' : '移除'}
                                </button>
                            </div>
                        ) : (
                            <UserSearchAdd
                                excludeUids={new Set()}
                                busyUid={null}
                                onAdd={u => set('owner', {uid: u.uid, name: u.displayName})}
                                addLabel={isEnglish ? 'Choose' : '选择'}
                                addingLabel={isEnglish ? 'Choosing...' : '选择中...'}
                                noMatchMessage={isEnglish ? 'No matching users.' : '没有匹配的用户。'}
                                showToast={showToast}
                            />
                        )}
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'Who looks after it. Shown when people sign in to it. Optional.'
                                : '负责维护该应用的人，登录时会显示。可不填。'}
                        </span>
                    </div>

                    <label className="admin-checkbox-label admin-api-key-option">
                        <input
                            type="checkbox"
                            checked={draft.signIn}
                            onChange={e => set('signIn', e.target.checked)}
                            disabled={saving}
                        />
                        <span>
                            <strong>{isEnglish ? 'People sign in to it with their account here' : '用户用本站账号登录此应用'}</strong>
                            <span className="admin-helper-text admin-api-key-option-desc">
                                {isEnglish
                                    ? 'Leave unticked for a server-only app that only uses API keys.'
                                    : '如果只是使用 API 密钥的后端服务，请取消勾选。'}
                            </span>
                        </span>
                    </label>

                    {draft.signIn && (
                        <>
                            <label className="admin-tickets-template-field">
                                <span>{isEnglish ? 'Redirect URIs' : '回调地址'}</span>
                                <textarea
                                    className="admin-input"
                                    value={draft.redirectUris}
                                    onChange={e => set('redirectUris', e.target.value)}
                                    placeholder={'https://skby-manager.web.app/\nhttp://127.0.0.1:5000/'}
                                    rows={3}
                                    disabled={saving}
                                />
                                <span className="admin-helper-text">
                                    {isEnglish
                                        ? 'One per line: where sign-in may hand people back to. https, or http on localhost or 127.0.0.1 for testing. Pages on these sites may also call the API from a browser.'
                                        : '每行一个：登录后可以返回的地址。须为 https；测试时可用 localhost 或 127.0.0.1 的 http 地址。这些网站上的页面也可以在浏览器中调用 API。'}
                                </span>
                            </label>

                            <fieldset className="admin-api-key-fieldset" disabled={saving}>
                                <legend>{isEnglish ? 'What it may read for the person signed in' : '可为登录者读取的内容'}</legend>
                                <p className="admin-helper-text">
                                    {isEnglish
                                        ? 'Every app gets the person\'s name, photo and group. Never their email.'
                                        : '每个应用都能获得登录者的名称、头像和组别，但不会获得邮箱。'}
                                </p>
                                {APP_SCOPES.map(scope => (
                                    <label key={scope} className="admin-checkbox-label admin-api-key-option">
                                        <input type="checkbox" checked={draft.scopes.includes(scope)}
                                               onChange={() => toggleScope(scope)}/>
                                        <span>
                                            <strong>{isEnglish ? APP_SCOPE_LABELS[scope].en : APP_SCOPE_LABELS[scope].zh}</strong>
                                            {' '}<code className="record-code">{scope}</code>
                                            <span className="admin-helper-text admin-api-key-option-desc">
                                                {isEnglish ? APP_SCOPE_LABELS[scope].descEn : APP_SCOPE_LABELS[scope].descZh}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>

                            <label className="admin-tickets-template-field">
                                <span>{isEnglish ? 'Firebase project ID' : 'Firebase 项目 ID'}</span>
                                <input
                                    className="admin-input"
                                    value={draft.firebaseProjectId}
                                    onChange={e => set('firebaseProjectId', e.target.value.trim())}
                                    placeholder="skby-manager"
                                    disabled={saving}
                                />
                            </label>

                            <label className="admin-tickets-template-field">
                                <span>{isEnglish ? 'Service account' : '服务账号'}</span>
                                <input
                                    className="admin-input"
                                    value={draft.serviceAccount}
                                    onChange={e => set('serviceAccount', e.target.value.trim())}
                                    placeholder="firebase-adminsdk-xxxxx@skby-manager.iam.gserviceaccount.com"
                                    disabled={saving}
                                />
                                <span className="admin-helper-text">
                                    {isEnglish
                                        ? 'A service account of that project, usually its Firebase Admin SDK one. Sign-ins to the app are signed as it.'
                                        : '该项目的服务账号，通常是其 Firebase Admin SDK 服务账号。应用的登录凭证将以它的身份签名。'}
                                </span>
                            </label>
                        </>
                    )}
                </div>
            </CreateSection>

            {error && !apps && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-error">
                    <span>{isEnglish ? 'Could not load apps. Try refreshing.' : '无法加载应用，请尝试刷新。'}</span>
                </div>
            )}

            {!apps && loading && <div className="spinner spinner-centered"/>}

            {apps && apps.length === 0 && !showForm && (
                <p className="admin-no-results">{isEnglish ? 'No apps yet.' : '暂无应用。'}</p>
            )}

            {apps && apps.length > 0 && (
                <div className="admin-api-key-list">
                    {apps.map(app => {
                        const signInEnabled = app.redirectUris.length > 0;
                        const addingKeyHere = keyAppId === app.id;
                        return (
                            <div key={app.id} className="admin-api-key-card">
                                <div className="admin-api-key-head">
                                    <span className="admin-api-key-name">{app.name}</span>
                                    <code className="record-code">{app.id}</code>
                                    <div className="admin-api-key-actions">
                                        <button
                                            className="admin-toggle-btn admin-toggle-grant admin-btn-sm"
                                            onClick={() => startNewKey(app)}
                                            disabled={deletingId === app.id || creatingKey}
                                            type="button"
                                        >
                                            {isEnglish ? '+ New Key' : '+ 新建密钥'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                            onClick={() => startEdit(app)}
                                            disabled={deletingId === app.id || saving}
                                            type="button"
                                        >
                                            {isEnglish ? 'Edit' : '编辑'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                            onClick={() => void remove(app)}
                                            disabled={deletingId === app.id}
                                            type="button"
                                        >
                                            {deletingId === app.id
                                                ? (isEnglish ? 'Removing...' : '移除中...')
                                                : (isEnglish ? 'Remove' : '移除')}
                                        </button>
                                    </div>
                                </div>
                                <div className="admin-api-key-tags">
                                    {!signInEnabled ? (
                                        <span className="admin-tickets-tag admin-tickets-tag-unlinked">
                                            {isEnglish ? 'No user sign-in' : '未开启用户登录'}
                                        </span>
                                    ) : app.scopes.length === 0 ? (
                                        <span className="admin-tickets-tag admin-tickets-tag-unlinked">
                                            {isEnglish ? 'Sign-in only' : '仅登录'}
                                        </span>
                                    ) : app.scopes.map(scope => (
                                        <span key={scope} className="admin-tickets-tag admin-tickets-tag-used">
                                            {isEnglish ? APP_SCOPE_LABELS[scope]?.en ?? scope : APP_SCOPE_LABELS[scope]?.zh ?? scope}
                                        </span>
                                    ))}
                                </div>
                                <div className="admin-api-key-meta">
                                    {app.ownerUid &&
                                        <span>{isEnglish ? 'Owner ' : '负责人 '}{app.ownerName || app.ownerUid}</span>}
                                    {app.firebaseProjectId && (
                                        <span>{isEnglish ? 'Project ' : '项目 '}<code
                                            className="record-code">{app.firebaseProjectId}</code></span>
                                    )}
                                    <span>
                                        {isEnglish
                                            ? `Registered ${fmtDate(app.createdAt)}${app.createdByName ? ` by ${app.createdByName}` : ''}`
                                            : `${app.createdByName ? `${app.createdByName} ` : ''}登记于 ${fmtDate(app.createdAt)}`}
                                    </span>
                                </div>
                                {signInEnabled && (
                                    <details className="admin-helper-text">
                                        <summary>{isEnglish ? 'Setup for its owner' : '负责人设置说明'}</summary>
                                        <p>
                                            {isEnglish ? 'Send people to ' : '将用户引导至 '}
                                            <code
                                                className="record-code">{`${window.location.origin}/authorize?app=${app.id}&state=<random>`}</code>
                                            {isEnglish
                                                ? '. They come back to one of these with #token=…&state=…; check the state, then signInWithCustomToken(token):'
                                                : '。登录后会返回以下地址之一，并附带 #token=…&state=…；核对 state 后调用 signInWithCustomToken(token)：'}
                                        </p>
                                        <ul>{app.redirectUris.map(uri => <li key={uri}><code
                                            className="record-code">{uri}</code></li>)}</ul>
                                        {signer ? (
                                            <>
                                                <p>
                                                    {isEnglish
                                                        ? 'Once, on the app\'s project: the first grant is needed for sign-in; the second lets signing out here sign people out of the app too.'
                                                        : '在应用的项目中执行一次：第一条是登录所必需的；第二条让用户在本站退出登录时也退出该应用。'}
                                                </p>
                                                {grants(app).map(command => (
                                                    <pre key={command}
                                                         className="record-code admin-app-grant">{command}</pre>
                                                ))}
                                            </>
                                        ) : (
                                            <p>
                                                {isEnglish
                                                    ? 'The account to grant roles to can\'t be told here (the emulator?).'
                                                    : '此处无法确定需要授权的账号（可能是模拟器环境）。'}
                                            </p>
                                        )}
                                    </details>
                                )}

                                {(addingKeyHere || app.keys.length > 0) && (
                                    <div className="admin-app-keys">
                                        {addingKeyHere && (
                                            <div className="admin-create-badge-form">
                                                <h4 className="admin-badges-title">
                                                    {recreatingKey
                                                        ? (isEnglish ? `Re-create API Key for ${app.name}` : `为 ${app.name} 重新创建 API 密钥`)
                                                        : (isEnglish ? `New API Key for ${app.name}` : `为 ${app.name} 创建 API 密钥`)}
                                                </h4>
                                                <div className="admin-api-key-form">
                                                    {recreatingKey ? (
                                                        <p className="admin-helper-text">
                                                            {isEnglish
                                                                ? <>Filled in
                                                                    from <strong>{recreatingKey.name}</strong>{' '}
                                                                    <code
                                                                        className="record-code">{recreatingKey.hint}</code>.
                                                                    A key can't be shown
                                                                    again, so this makes a new one
                                                                    under <strong>{app.name}</strong>.{' '}
                                                                    {isExpired(recreatingKey, serverNow)
                                                                        ? 'Delete the expired one once the new key is in place.'
                                                                        : 'The old one keeps working until you revoke it, so swap the new key in first.'}</>
                                                                : <>已从 <strong>{recreatingKey.name}</strong>{' '}
                                                                    <code
                                                                        className="record-code">{recreatingKey.hint}</code> 填入设置。密钥无法再次显示，因此将在 <strong>{app.name}</strong> 下创建一个新密钥。
                                                                    {isExpired(recreatingKey, serverNow)
                                                                        ? '新密钥启用后，可删除已过期的旧密钥。'
                                                                        : '旧密钥在吊销前仍然有效，请先换上新密钥。'}</>}
                                                        </p>
                                                    ) : (
                                                        <p className="admin-helper-text">
                                                            {isEnglish
                                                                ? 'A key gives a server admin-level access to the ticket API for this app. Give keys only to our own systems and partners\' servers we trust, never put one inside a browser or client app, and revoke it if it leaks.'
                                                                : '密钥可让服务器代表此应用以管理员级别访问门票 API。密钥只能交给我们自己的系统和可信合作方的服务器，切勿放进浏览器或客户端应用内；如有泄露请立即吊销。'}
                                                        </p>
                                                    )}

                                                    <label className="admin-tickets-template-field">
                                                        <span>{isEnglish ? 'Key name' : '密钥名称'}</span>
                                                        <input
                                                            className="admin-input"
                                                            value={keyName}
                                                            onChange={e => setKeyName(e.target.value)}
                                                            placeholder={isEnglish ? 'e.g. Production server' : '例如：生产服务器'}
                                                            maxLength={60}
                                                            disabled={creatingKey}
                                                        />
                                                    </label>

                                                    <fieldset className="admin-api-key-fieldset" disabled={creatingKey}>
                                                        <legend>{isEnglish ? 'What it may do' : '权限'}</legend>
                                                        {API_SCOPES.map(scope => (
                                                            <label key={scope}
                                                                   className="admin-checkbox-label admin-api-key-option">
                                                                <input type="checkbox"
                                                                       checked={keyScopes.includes(scope)}
                                                                       onChange={() => toggleKeyScope(scope)}/>
                                                                <span>
                                                                    <strong>{isEnglish ? KEY_SCOPE_LABELS[scope].en : KEY_SCOPE_LABELS[scope].zh}</strong>
                                                                    {' '}<code className="record-code">{scope}</code>
                                                                    <span
                                                                        className="admin-helper-text admin-api-key-option-desc">
                                                                        {isEnglish ? KEY_SCOPE_LABELS[scope].descEn : KEY_SCOPE_LABELS[scope].descZh}
                                                                    </span>
                                                                </span>
                                                            </label>
                                                        ))}
                                                    </fieldset>

                                                    <fieldset className="admin-api-key-fieldset" disabled={creatingKey}>
                                                        <legend>{isEnglish ? 'Events' : '活动'}</legend>
                                                        <label className="admin-checkbox-label">
                                                            <input type="radio" name={`api-key-events-${app.id}`}
                                                                   checked={allEvents}
                                                                   onChange={() => setAllEvents(true)}/>
                                                            <span>{isEnglish ? 'Every event' : '所有活动'}</span>
                                                        </label>
                                                        <label className="admin-checkbox-label">
                                                            <input type="radio" name={`api-key-events-${app.id}`}
                                                                   checked={!allEvents}
                                                                   onChange={() => setAllEvents(false)}/>
                                                            <span>{isEnglish ? 'Only these events' : '仅限以下活动'}</span>
                                                        </label>
                                                        {!allEvents && (
                                                            pickableEventIds.length === 0 ? (
                                                                <p className="admin-helper-text">
                                                                    {isEnglish ? 'There are no upcoming events yet.' : '暂无即将举行的活动。'}
                                                                </p>
                                                            ) : (
                                                                <div className="admin-api-key-events">
                                                                    {pickableEventIds.map(id => (
                                                                        <label key={id}
                                                                               className="admin-checkbox-label">
                                                                            <input type="checkbox"
                                                                                   checked={eventIds.includes(id)}
                                                                                   onChange={() => toggleEvent(id)}/>
                                                                            <span>{eventTitle(id)}</span>
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
                                                            disabled={creatingKey}
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
                                                <div className="admin-btn-row admin-mt-12">
                                                    <button
                                                        className="admin-toggle-btn admin-toggle-save"
                                                        onClick={() => void createKey(app)}
                                                        disabled={creatingKey || !canCreateKey}
                                                        type="button"
                                                    >
                                                        {creatingKey
                                                            ? (isEnglish ? 'Creating...' : '创建中...')
                                                            : (isEnglish ? 'Create Key' : '创建密钥')}
                                                    </button>
                                                    <button
                                                        className="admin-toggle-btn admin-toggle-cancel"
                                                        onClick={resetKeyForm}
                                                        disabled={creatingKey}
                                                        type="button"
                                                    >
                                                        {isEnglish ? 'Cancel' : '取消'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {app.keys.map(k => {
                                            const expired = isExpired(k, serverNow);
                                            const renaming = renamingId === k.id;
                                            return (
                                                <div key={k.id}
                                                     className={`admin-app-key${expired ? ' admin-api-key-card--inactive' : ''}`}>
                                                    <div className="admin-api-key-head">
                                                        {renaming ? (
                                                            <form
                                                                className="admin-api-key-rename"
                                                                onSubmit={e => {
                                                                    e.preventDefault();
                                                                    void saveRenameKey(k);
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
                                                                    onClick={() => startRenameKey(k)}
                                                                    disabled={revokingId === k.id}
                                                                    type="button"
                                                                >
                                                                    {isEnglish ? 'Rename' : '重命名'}
                                                                </button>
                                                                <button
                                                                    className="admin-toggle-btn admin-toggle-grant admin-btn-sm"
                                                                    onClick={() => startRecreateKey(k)}
                                                                    disabled={revokingId === k.id || creatingKey}
                                                                    type="button"
                                                                >
                                                                    {isEnglish ? 'Re-create' : '重新创建'}
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
                                                            <span key={scope}
                                                                  className="admin-tickets-tag admin-tickets-tag-used">
                                                                {isEnglish ? KEY_SCOPE_LABELS[scope]?.en ?? scope : KEY_SCOPE_LABELS[scope]?.zh ?? scope}
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
                    })}
                </div>
            )}
        </div>
    );
};
