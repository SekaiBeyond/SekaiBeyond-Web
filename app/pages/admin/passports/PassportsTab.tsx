import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGeneratePassportBatch } from '~/lib/firebase';
import {
    fetchPassport,
    fetchPassportsByDesign,
    fetchPassportsByOwner,
    isPassportCodeShape,
    MAX_PASSPORT_BATCH,
    type Passport,
    PASSPORT_ID_LENGTH,
    passportDateTime,
    type PassportDesign,
    passportName,
    passportStatusLabel,
    usePassportDesigns,
} from '~/lib/passports';
import { confirmExit, useExitGuard } from '~/lib/useExitGuard';
import { downloadBlob } from '~/lib/zip';
import { StatTile } from '../StatTile';
import { searchUsers, type ShowToast } from '../utils';
import type { UserRecord } from '../types';
import { PassportDesignsSection } from './PassportDesignsSection';
import { PassportDetail } from './PassportDetail';
import { buildPassportCsv, buildPassportIdCsv, usePassportPngExport } from './passportExport';

type View = 'dashboard' | 'generate' | 'detail' | 'designs';

interface PassportsTabProps {
    /** Jumps to the holder in Users Management, as the records tab does. */
    onLookupUser: (uid: string) => void;
    showToast: ShowToast;
    /** Staff (non-core) get the whole tab read-only, like the rest of the panel. */
    readOnly: boolean;
}

/** How the admin screens tell designs apart: a year can have several. */
const designLabel = (design: PassportDesign, isEnglish: boolean): string =>
    `${design.year} · ${passportName(design, isEnglish)}`;

/**
 * Passports tab: one design's stock at a time, with batch generation, per-batch
 * exports, a code/owner lookup, and the design editor.
 *
 * Queries are equality-only (`designId`, `ownerUid`, or a document id) and
 * sorting happens here, so no composite index is needed — a design is a few
 * hundred documents.
 */
export const PassportsTab = ({onLookupUser, showToast, readOnly}: PassportsTabProps) => {
    const {designs, loading: designsLoading, refresh: refreshDesigns} = usePassportDesigns();

    const [view, setView] = useState<View>('dashboard');
    const [designId, setDesignId] = useState<string | null>(null);
    const [passports, setPassports] = useState<Passport[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Default to the newest design, follow it if the design list arrives late, and
    // fall back to it if the selected design is deleted — the `<select>` would
    // otherwise paint an option the stats and exports below disagree with.
    useEffect(() => {
        if (designs.length === 0) return;
        if (designId === null || !designs.some(d => d.id === designId)) setDesignId(designs[0].id);
    }, [designs, designId]);

    // The design can be switched again while a load is in flight, and the second
    // query may well answer first — only the newest load may write, or the tab
    // paints one design's stock under another design's heading and exports.
    const designToken = useRef(0);
    const loadDesign = useCallback(async (target: string) => {
        const mine = ++designToken.current;
        setLoadError(false);
        setPassports(null);
        try {
            const list = await fetchPassportsByDesign(target);
            if (mine === designToken.current) setPassports(list);
        } catch {
            if (mine === designToken.current) setLoadError(true);
        }
    }, []);

    useEffect(() => {
        if (designId === null) return;
        void loadDesign(designId);
    }, [designId, loadDesign]);

    const refresh = useCallback(async () => {
        if (designId !== null) await loadDesign(designId);
    }, [designId, loadDesign]);

    // A void or a reissue changes exactly one passport, and the detail page has
    // already refetched it — patching it in beats re-reading the design, which is
    // every document the tab is holding.
    const applyChange = useCallback((fresh: Passport) => {
        setPassports(list => list?.map(p => p.id === fresh.id ? fresh : p) ?? list);
    }, []);

    const selected = passports?.find(p => p.id === selectedId) ?? null;

    if (view === 'designs') {
        return (
            <PassportDesignsSection
                designs={designs}
                loading={designsLoading}
                onBack={() => setView('dashboard')}
                onChanged={refreshDesigns}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    if (view === 'detail' && selectedId) {
        return (
            <PassportDetail
                passportId={selectedId}
                initial={selected}
                onBack={() => setView('dashboard')}
                onChanged={applyChange}
                onLookupUser={onLookupUser}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    if (view === 'generate' && !readOnly) {
        return (
            <BatchGenerator
                designs={designs}
                defaultDesignId={designId}
                onBack={() => {
                    setView('dashboard');
                    void refresh();
                }}
                showToast={showToast}
            />
        );
    }

    return (
        <Dashboard
            designs={designs}
            designsLoading={designsLoading}
            designId={designId}
            setDesignId={setDesignId}
            passports={passports}
            loadError={loadError}
            onRefresh={refresh}
            onOpen={id => {
                setSelectedId(id);
                setView('detail');
            }}
            onGenerate={() => setView('generate')}
            onDesigns={() => setView('designs')}
            showToast={showToast}
            readOnly={readOnly}
        />
    );
};

interface DashboardProps {
    designs: PassportDesign[];
    designsLoading: boolean;
    designId: string | null;
    setDesignId: (designId: string) => void;
    passports: Passport[] | null;
    loadError: boolean;
    onRefresh: () => Promise<void>;
    onOpen: (id: string) => void;
    onGenerate: () => void;
    onDesigns: () => void;
    showToast: ShowToast;
    readOnly: boolean;
}

const Dashboard = ({
                       designs,
                       designsLoading,
                       designId,
                       setDesignId,
                       passports,
                       loadError,
                       onRefresh,
                       onOpen,
                       onGenerate,
                       onDesigns,
                       showToast,
                       readOnly,
                   }: DashboardProps) => {
    const {isEnglish} = useLanguage();
    const [refreshing, setRefreshing] = useState(false);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const year = designs.find(d => d.id === designId)?.year;

    const stats = useMemo(() => {
        const list = passports ?? [];
        return {
            total: list.length,
            unclaimed: list.filter(p => p.status === 'unclaimed').length,
            claimed: list.filter(p => p.status === 'claimed').length,
            voided: list.filter(p => p.status === 'void').length,
            scans: list.reduce((sum, p) => sum + p.scanCount, 0),
        };
    }, [passports]);

    // Batches are derived from the passports themselves rather than stored: every
    // passport already carries its batchId, creator, and creation time.
    const batches = useMemo(() => {
        const grouped = new Map<string, Passport[]>();
        for (const passport of passports ?? []) {
            const list = grouped.get(passport.batchId) ?? [];
            list.push(passport);
            grouped.set(passport.batchId, list);
        }
        return [...grouped.entries()]
            .map(([batchId, list]) => ({
                batchId,
                list,
                createdAt: list.reduce<Date | null>((newest, p) =>
                    !newest || (p.createdAt && p.createdAt > newest) ? (p.createdAt ?? newest) : newest, null),
                createdByName: list.find(p => p.createdByName)?.createdByName ?? '',
                claimed: list.filter(p => p.status === 'claimed').length,
                voided: list.filter(p => p.status === 'void').length,
            }))
            .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    }, [passports]);

    const doRefresh = async () => {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    };

    const fmtDate = (date: Date | null): string => passportDateTime(date, isEnglish, '—');

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <h3 className="admin-tools-title">{isEnglish ? 'Passports' : '通行证'}</h3>
                <div className="admin-btn-row">
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={doRefresh} disabled={refreshing}>
                        {refreshing ? (isEnglish ? 'Loading...' : '加载中...') : (isEnglish ? 'Refresh' : '刷新')}
                    </button>
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={onDesigns}>
                        {isEnglish ? 'Designs' : '设计'}
                    </button>
                    {!readOnly && (
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={onGenerate}
                            disabled={designs.length === 0}
                            title={designs.length === 0
                                ? (isEnglish ? 'Create a design first' : '请先创建设计')
                                : undefined}
                        >
                            {isEnglish ? '+ Generate Batch' : '+ 生成批次'}
                        </button>
                    )}
                </div>
            </div>

            {designsLoading ? (
                <div className="spinner spinner-centered"/>
            ) : designs.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish
                        ? 'No passport designs yet. Add one before generating passports — a year can have several.'
                        : '暂无通行证设计。请先添加设计，然后再生成通行证 — 每年可以有多款设计。'}
                </p>
            ) : (
                <>
                    <div className="admin-form-grid admin-section-mb">
                        <label>
                            <span>{isEnglish ? 'Design' : '设计'}</span>
                            <select
                                className="admin-input"
                                value={designId ?? ''}
                                onChange={e => setDesignId(e.target.value)}
                            >
                                {designs.map(design => (
                                    <option key={design.id} value={design.id}>{designLabel(design, isEnglish)}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="admin-stats-tiles admin-section-mb">
                        <StatTile label={isEnglish ? 'Generated' : '已生成'} value={stats.total}/>
                        <StatTile label={isEnglish ? 'Unclaimed' : '未激活'} value={stats.unclaimed}/>
                        <StatTile label={isEnglish ? 'Claimed' : '已激活'} value={stats.claimed}/>
                        <StatTile label={isEnglish ? 'Void' : '已作废'} value={stats.voided}/>
                        <StatTile label={isEnglish ? 'Scans' : '扫描数'} value={stats.scans}/>
                    </div>

                    <PassportSearch designs={designs} onOpen={onOpen} showToast={showToast}/>

                    {loadError ? (
                        <p className="admin-no-results">
                            {isEnglish ? 'Failed to load passports.' : '加载通行证失败。'}
                        </p>
                    ) : passports === null ? (
                        <div className="spinner spinner-centered"/>
                    ) : batches.length === 0 ? (
                        <p className="admin-no-results">
                            {isEnglish
                                ? 'No passports generated from this design yet.'
                                : '此设计尚未生成通行证。'}
                        </p>
                    ) : (
                        <div className="admin-field-section">
                            <span className="admin-field-label">{isEnglish ? 'Batches' : '批次'}</span>
                            {progress && (
                                <p className="admin-helper-text">
                                    {isEnglish
                                        ? `Rendering QR codes… ${progress.done}/${progress.total}`
                                        : `正在生成二维码… ${progress.done}/${progress.total}`}
                                </p>
                            )}
                            <div className="admin-passport-batches">
                                {batches.map(batch => (
                                    <div key={batch.batchId} className="admin-passport-batch">
                                        <div className="admin-passport-batch-head">
                                            <span className="admin-passport-batch-title">
                                                {fmtDate(batch.createdAt)}
                                                {batch.createdByName && ` · ${batch.createdByName}`}
                                            </span>
                                            <span className="admin-passport-batch-counts">
                                                {isEnglish
                                                    ? `${batch.list.length} generated · ${batch.claimed} claimed · ${batch.voided} void`
                                                    : `已生成 ${batch.list.length} · 已激活 ${batch.claimed} · 已作废 ${batch.voided}`}
                                            </span>
                                        </div>
                                        <div className="admin-tag-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => downloadBlob(
                                                    buildPassportIdCsv(batch.list.map(p => p.id), origin),
                                                    `passports-${year}-${batch.batchId.slice(0, 6)}-ids.csv`,
                                                )}
                                                type="button"
                                            >
                                                {isEnglish ? 'Codes CSV' : '编号 CSV'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => requestPngs(
                                                    batch.list.map(p => p.id),
                                                    `passports-${year}-${batch.batchId.slice(0, 6)}`,
                                                )}
                                                disabled={!!progress}
                                                type="button"
                                            >
                                                {isEnglish ? 'Stickers ZIP' : '贴纸 ZIP'}
                                            </button>
                                        </div>
                                        <p className="admin-helper-text admin-field-hint">
                                            {isEnglish
                                                ? 'Re-exports carry public codes only — open a passport to view its activation key.'
                                                : '重新导出仅包含公开编号 — 打开单本通行证即可查看其激活码。'}
                                        </p>
                                        <div className="admin-passport-codes">
                                            {batch.list.map(passport => (
                                                <button
                                                    key={passport.id}
                                                    className={`admin-passport-code admin-passport-code--${passport.status}`}
                                                    onClick={() => onOpen(passport.id)}
                                                    type="button"
                                                    title={passportStatusLabel(passport.status, isEnglish)}
                                                >
                                                    {passport.id}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
            {pngNode}
        </div>
    );
};

/**
 * Look a passport up by the code on the sticker, or by its owner. A 10-character
 * code resolves directly; anything else is matched against users the same way
 * every other admin surface does, then each match's passports are listed.
 */
const PassportSearch = ({designs, onOpen, showToast}: {
    designs: PassportDesign[];
    onOpen: (id: string) => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const [term, setTerm] = useState('');
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<{passport: Passport; owner?: UserRecord}[] | null>(null);

    const run = async () => {
        const query = term.trim();
        if (!query) return;
        setBusy(true);
        setResults(null);
        try {
            if (isPassportCodeShape(query, PASSPORT_ID_LENGTH)) {
                const passport = await fetchPassport(query);
                setResults(passport ? [{passport}] : []);
                return;
            }
            // searchUsers returns up to 30 matches; their passports are fetched
            // together rather than one round trip at a time.
            const owners = await searchUsers(query);
            const perOwner = await Promise.all(owners.map(owner => fetchPassportsByOwner(owner.uid)));
            setResults(owners.flatMap((owner, i) => perOwner[i].map(passport => ({passport, owner}))));
        } catch {
            showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="admin-field-section admin-section-mb">
            <span className="admin-field-label">{isEnglish ? 'Find a Passport' : '查找通行证'}</span>
            <div className="admin-title-input-row">
                <input
                    className="admin-input admin-input--sm"
                    value={term}
                    onChange={e => setTerm(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') void run();
                    }}
                    placeholder={isEnglish ? 'Passport code, name, or email' : '通行证编号、姓名或邮箱'}
                />
                <button className="admin-btn admin-btn--cta" onClick={() => void run()} disabled={busy || !term.trim()}>
                    {busy ? (isEnglish ? 'Searching...' : '搜索中...') : (isEnglish ? 'Search' : '搜索')}
                </button>
                {results !== null && (
                    <button
                        className="admin-btn admin-btn--outline"
                        onClick={() => {
                            setResults(null);
                            setTerm('');
                        }}
                    >
                        {isEnglish ? 'Clear' : '清除'}
                    </button>
                )}
            </div>
            {results !== null && (results.length === 0 ? (
                <p className="admin-no-results">{isEnglish ? 'No passports found.' : '未找到通行证。'}</p>
            ) : (
                <div className="admin-passport-results">
                    {results.map(({passport, owner}) => (
                        <button
                            key={passport.id}
                            className="admin-qr-row"
                            onClick={() => onOpen(passport.id)}
                            type="button"
                        >
                            <span className="admin-qr-row-main">
                                <span className="admin-qr-row-title">
                                    {passport.id}
                                    <span className={`admin-qr-badge admin-passport-badge--${passport.status}`}>
                                        {passportStatusLabel(passport.status, isEnglish)}
                                    </span>
                                </span>
                                <span className="admin-qr-row-sub">
                                    {passport.year} · {passportName(designs.find(d => d.id === passport.designId), isEnglish)}
                                    {owner ? ` · ${owner.displayName} (${owner.email})` : ''}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );
};

interface BatchGeneratorProps {
    designs: PassportDesign[];
    defaultDesignId: string | null;
    onBack: () => void;
    showToast: ShowToast;
}

/**
 * Generate a batch and hand over the print files. This is the only place the
 * activation keys come back in bulk — leaving this screen without exporting means
 * looking each passport's key up one at a time.
 */
const BatchGenerator = ({designs, defaultDesignId, onBack, showToast}: BatchGeneratorProps) => {
    const {isEnglish} = useLanguage();
    const [designId, setDesignId] = useState(defaultDesignId ?? designs[0]?.id ?? '');
    const [count, setCount] = useState(50);
    const [busy, setBusy] = useState(false);
    const [issued, setIssued] = useState<{
        batchId: string;
        designId: string;
        year: number;
        passports: {passportId: string; activationCode: string}[];
    } | null>(null);
    const [exported, setExported] = useState(false);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const selectedDesign = designs.find(d => d.id === designId);
    const issuedDesign = passportName(designs.find(d => d.id === issued?.designId), isEnglish);

    // Armed the moment keys exist that aren't on disk yet. Covers closing the
    // tab, reloading, and switching admin tabs — none of which the Back button's
    // confirm ever saw.
    useExitGuard(!!issued && !exported, isEnglish
        ? 'You haven’t downloaded the activation keys. After leaving this screen they can only be viewed one passport at a time. Leave anyway?'
        : '你还没有下载激活码。离开此页面后只能逐本查看。仍要离开吗？');

    const exportCsv = (batch: NonNullable<typeof issued>) => {
        downloadBlob(
            buildPassportCsv(batch.passports, origin),
            `passports-${batch.year}-${batch.batchId.slice(0, 6)}-keys.csv`,
        );
        setExported(true);
    };

    const generate = async () => {
        setBusy(true);
        try {
            const res = await callGeneratePassportBatch({designId, count});
            setIssued(res.data);
            // Save them without being asked. Every way off this screen leaves the
            // keys retrievable only one passport at a time, so the file is written
            // first and the screen becomes a confirmation rather than the only
            // batch copy. Only a throw re-arms the warning — a download the browser
            // silently blocks still reads as exported, which is why the banner
            // tells the admin to go and look for the file.
            setExported(false);
            try {
                exportCsv(res.data);
            } catch {
                showToast(isEnglish
                    ? 'Passports generated, but the keys CSV didn’t download. Use the button below before leaving.'
                    : '通行证已生成，但激活码 CSV 未能下载。请在离开前使用下方按钮下载。', 'warning');
            }
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to generate passports.' : '生成通行证失败。'), 'error');
        } finally {
            setBusy(false);
        }
    };

    // The guard owns the wording now, so Back asks the same question every other
    // way out of this screen does.
    const leave = () => {
        if (confirmExit()) onBack();
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={leave} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Generate Passports' : '生成通行证'}</h3>
            </div>

            {!issued ? (
                <>
                    <div className="admin-passport-warning">
                        <strong>{isEnglish ? 'Read before generating' : '生成前请阅读'}</strong>
                        <p>
                            {isEnglish
                                ? 'Each passport gets a public code for its sticker and a secret activation key for the slip packed beside it. The keys are listed together only on the next screen — download the CSV before you leave it. After that, each passport’s key can be viewed from its own page.'
                                : '每本通行证都会生成一个用于贴纸的公开编号，以及一个印在同装纸条上的秘密激活码。激活码仅在下一屏集中列出 — 请在离开前下载 CSV。之后只能在每本通行证的页面中单独查看。'}
                        </p>
                    </div>
                    <div className="admin-form-grid admin-section-mb">
                        <label>
                            <span>{isEnglish ? 'Design' : '设计'}</span>
                            <select className="admin-input" value={designId}
                                    onChange={e => setDesignId(e.target.value)}>
                                {designs.map(design => (
                                    <option key={design.id} value={design.id}>{designLabel(design, isEnglish)}</option>
                                ))}
                            </select>
                            {selectedDesign && (
                                <small className="admin-title-hint">
                                    {isEnglish
                                        ? `Each passport grants ${selectedDesign.termDays} days of membership.`
                                        : `每本通行证授予 ${selectedDesign.termDays} 天会员资格。`}
                                </small>
                            )}
                        </label>
                        <label>
                            <span>{isEnglish ? `Count (1–${MAX_PASSPORT_BATCH})` : `数量（1–${MAX_PASSPORT_BATCH}）`}</span>
                            <input
                                type="number"
                                className="admin-input"
                                min={1}
                                max={MAX_PASSPORT_BATCH}
                                value={count}
                                onChange={e => setCount(Math.max(1, Math.min(MAX_PASSPORT_BATCH, Number(e.target.value) || 1)))}
                            />
                        </label>
                    </div>
                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => void generate()}
                            disabled={busy || !designId}
                        >
                            {busy
                                ? (isEnglish ? 'Generating...' : '生成中...')
                                : (isEnglish ? `Generate ${count} passports` : `生成 ${count} 本通行证`)}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={onBack} disabled={busy}>
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <div className={`admin-passport-warning${exported ? '' : ' admin-passport-warning--urgent'}`}>
                        <strong>
                            {exported
                                ? (isEnglish ? 'Keys saved' : '激活码已保存')
                                : (isEnglish ? 'Download the keys now' : '请立即下载激活码')}
                        </strong>
                        <p>
                            {isEnglish
                                ? `${issued.passports.length} passports generated from ${issued.year} · ${issuedDesign}. `
                                : `已根据 ${issued.year} · ${issuedDesign} 生成 ${issued.passports.length} 本通行证。`}
                            {exported
                                ? (isEnglish
                                    ? 'The keys CSV has been downloaded to this device — check your downloads folder before packing. Once you leave, it is the only list of the whole batch.'
                                    : '激活码 CSV 已下载到此设备 — 请在装袋前确认下载文件夹。离开此页面后，它将是整批激活码的唯一清单。')
                                : (isEnglish
                                    ? 'This is the only screen that lists the whole batch’s keys.'
                                    : '只有此页面会列出整批激活码。')}
                        </p>
                    </div>
                    <div className="admin-btn-row admin-section-mb">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => exportCsv(issued)}
                            type="button"
                        >
                            {exported
                                ? (isEnglish ? 'Download keys CSV again' : '重新下载激活码 CSV')
                                : (isEnglish ? 'Download keys CSV' : '下载激活码 CSV')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-edit"
                            onClick={() => requestPngs(
                                issued.passports.map(p => p.passportId),
                                `passports-${issued.year}-${issued.batchId.slice(0, 6)}`,
                            )}
                            disabled={!!progress}
                            type="button"
                        >
                            {progress
                                ? (isEnglish ? `Rendering ${progress.done}/${progress.total}…` : `生成中 ${progress.done}/${progress.total}…`)
                                : (isEnglish ? 'Download stickers ZIP' : '下载贴纸 ZIP')}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={leave} type="button">
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </div>
                    <div className="admin-passport-key-table">
                        {issued.passports.map(row => (
                            <div key={row.passportId} className="admin-passport-key-row">
                                <span className="admin-passport-key-code">{row.passportId}</span>
                                <span className="admin-passport-key-secret">{row.activationCode}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
            {pngNode}
        </div>
    );
};
