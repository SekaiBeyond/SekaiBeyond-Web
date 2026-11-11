import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    APP_ID_RE,
    APP_SCOPES,
    type AppScope,
    type AppSummary,
    callDeleteApp,
    callListApps,
    callSaveApp,
    functionsErrorCode,
} from '~/lib/firebase';
import { CreateSection } from '../CrudShell';
import { UserSearchAdd } from '../UserSearchAdd';
import type { ShowToast } from '../utils';

interface AppsToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

const SCOPE_LABELS: Record<AppScope, {en: string; zh: string; descEn: string; descZh: string}> = {
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
        descEn: 'An event\'s staff, if the person signed in is staff, or staff of that event.',
        descZh: '某个活动的工作人员名单（仅限登录者为工作人员或该活动的工作人员时）。',
    },
};

interface Draft {
    appId: string;
    name: string;
    owner: {uid: string; name: string} | null;
    redirectUris: string;
    scopes: AppScope[];
    firebaseProjectId: string;
    serviceAccount: string;
}

const EMPTY_DRAFT: Draft = {
    appId: '',
    name: '',
    owner: null,
    redirectUris: '',
    scopes: [],
    firebaseProjectId: '',
    serviceAccount: '',
};

const redirectLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

/**
 * Apps people sign in to with their accounts here (functions/src/utils/apps.ts):
 * registering one says where its sign-ins go and what of the site it may read
 * for the person signed in. What it does with that, and who may do what in it,
 * is its owner's to decide, in the app.
 */
export const AppsTool = ({onBack, showToast}: AppsToolProps) => {
    const {isEnglish} = useLanguage();
    const [apps, setApps] = useState<AppSummary[] | null>(null);
    const [signer, setSigner] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const [showForm, setShowForm] = useState(false);
    // The app being changed, or null for a new one.
    const [editing, setEditing] = useState<AppSummary | null>(null);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const formRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async (notify: boolean) => {
        setLoading(true);
        try {
            const res = await callListApps();
            setApps(res.data.apps);
            setSigner(res.data.signer);
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

    const canSave = APP_ID_RE.test(draft.appId) && !!draft.name.trim() && redirectLines(draft.redirectUris).length > 0
        && !!draft.firebaseProjectId.trim() && !!draft.serviceAccount.trim();

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await callSaveApp({
                appId: draft.appId,
                create: !editing,
                name: draft.name.trim(),
                ownerUid: draft.owner?.uid ?? '',
                redirectUris: redirectLines(draft.redirectUris),
                scopes: draft.scopes,
                firebaseProjectId: draft.firebaseProjectId.trim(),
                serviceAccount: draft.serviceAccount.trim(),
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
            ? `Remove "${app.name}"? Nobody can sign in to it with their account here any more, and the API stops answering it within seconds. Its own data stays with it.`
            : `移除"${app.name}"？此后将无法再用本站账号登录该应用，API 也会在几秒内停止响应它。该应用自己的数据不受影响。`)) return;
        setDeletingId(app.id);
        try {
            await callDeleteApp({appId: app.id});
            showToast(isEnglish ? 'App removed.' : '应用已移除。', 'warning');
            await load(false);
        } catch (err) {
            console.error('[AppsTool] delete', err);
            showToast(isEnglish ? 'Failed to remove the app.' : '移除应用失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const fmtDate = (iso: string | null) => iso
        ? new Date(iso).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {year: 'numeric', month: 'short', day: 'numeric'})
        : '';

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
                    ? 'Apps are projects of their own, like SKBY Manager, that people sign in to with their account here. The site tells an app who someone is, and lets it read what that person could see here, as far as the scopes below allow. Who may do what in the app, and its own data, are up to its owner. Anyone with an account can sign in to a registered app.'
                    : '应用是独立的项目（例如 SKBY Manager），用户可以用本站账号登录。本站会告诉应用登录者是谁，并允许应用读取该登录者在本站可以看到的内容（以下列权限为限）。应用内谁能做什么、以及应用自己的数据，都由应用负责人决定。任何本站账号都可以登录已登记的应用。'}
            </p>

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
                                ? 'What the app signs people in with, and in every sign-in it has, so it can\'t change. Lowercase letters, digits and -.'
                                : '应用用它发起登录，每次登录也会带上它，因此无法更改。仅限小写字母、数字和 -。'}
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
                            {isEnglish ? 'Shown to people when they sign in to it.' : '登录时向用户显示。'}
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
                                    <strong>{isEnglish ? SCOPE_LABELS[scope].en : SCOPE_LABELS[scope].zh}</strong>
                                    {' '}<code className="record-code">{scope}</code>
                                    <span className="admin-helper-text admin-api-key-option-desc">
                                        {isEnglish ? SCOPE_LABELS[scope].descEn : SCOPE_LABELS[scope].descZh}
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
                    {apps.map(app => (
                        <div key={app.id} className="admin-api-key-card">
                            <div className="admin-api-key-head">
                                <span className="admin-api-key-name">{app.name}</span>
                                <code className="record-code">{app.id}</code>
                                <div className="admin-api-key-actions">
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
                                {app.scopes.length === 0 ? (
                                    <span className="admin-tickets-tag admin-tickets-tag-unlinked">
                                        {isEnglish ? 'Sign-in only' : '仅登录'}
                                    </span>
                                ) : app.scopes.map(scope => (
                                    <span key={scope} className="admin-tickets-tag admin-tickets-tag-used">
                                        {isEnglish ? SCOPE_LABELS[scope]?.en ?? scope : SCOPE_LABELS[scope]?.zh ?? scope}
                                    </span>
                                ))}
                            </div>
                            <div className="admin-api-key-meta">
                                {app.ownerUid && <span>{isEnglish ? 'Owner ' : '负责人 '}{app.ownerName || app.ownerUid}</span>}
                                <span>{isEnglish ? 'Project ' : '项目 '}<code className="record-code">{app.firebaseProjectId}</code></span>
                                <span>
                                    {isEnglish
                                        ? `Registered ${fmtDate(app.createdAt)}${app.createdByName ? ` by ${app.createdByName}` : ''}`
                                        : `${app.createdByName ? `${app.createdByName} ` : ''}登记于 ${fmtDate(app.createdAt)}`}
                                </span>
                            </div>
                            <details className="admin-helper-text">
                                <summary>{isEnglish ? 'Setup for its owner' : '负责人设置说明'}</summary>
                                <p>
                                    {isEnglish ? 'Send people to ' : '将用户引导至 '}
                                    <code className="record-code">{`${window.location.origin}/authorize?app=${app.id}&state=<random>`}</code>
                                    {isEnglish
                                        ? '. They come back to one of these with #token=…&state=…; check the state, then signInWithCustomToken(token):'
                                        : '。登录后会返回以下地址之一，并附带 #token=…&state=…；核对 state 后调用 signInWithCustomToken(token)：'}
                                </p>
                                <ul>{app.redirectUris.map(uri => <li key={uri}><code className="record-code">{uri}</code></li>)}</ul>
                                {signer ? (
                                    <>
                                        <p>
                                            {isEnglish
                                                ? 'Once, on the app\'s project: the first grant is needed for sign-in; the second lets signing out here sign people out of the app too.'
                                                : '在应用的项目中执行一次：第一条是登录所必需的；第二条让用户在本站退出登录时也退出该应用。'}
                                        </p>
                                        {grants(app).map(command => (
                                            <pre key={command} className="record-code admin-app-grant">{command}</pre>
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
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
