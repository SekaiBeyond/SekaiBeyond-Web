import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGeneratePassports } from '~/lib/firebase';
import {
    fetchPassport,
    fetchPassportsByDesign,
    fetchPassportsByOwner,
    isPassportCodeShape,
    MAX_PASSPORT_GENERATE,
    type Passport,
    PASSPORT_ID_LENGTH,
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
import { buildPassportCsv, fileStamp, usePassportPngExport } from './passportExport';
import { INITIAL_STOCK_VIEW, PassportStock, type StockView } from './PassportStock';

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
 * Passports tab: one design's stock at a time — generating passports, the stock
 * table and its exports, a code/owner lookup, and the design editor.
 *
 * Every passport is its own document and nothing records which ones were minted
 * together, so the stock is one sortable table narrowed by status rather than
 * anything grouped by print run.
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
    // Held here rather than in the table, which is unmounted whenever a passport
    // is open — see StockView. Switching designs starts both over, since a page
    // number into one design's stock means nothing in another's, and neither does
    // a selection of another design's codes.
    const [stockView, setStockView] = useState<StockView>(INITIAL_STOCK_VIEW);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
        setStockView(INITIAL_STOCK_VIEW);
        setSelectedIds([]);
        void loadDesign(designId);
    }, [designId, loadDesign]);

    const refresh = useCallback(async () => {
        if (designId !== null) await loadDesign(designId);
    }, [designId, loadDesign]);

    // A key reissue changes exactly one passport, and the detail page has already
    // refetched it — patching it in beats re-reading the design, which is every
    // document the tab is holding. A delete drops the row the same way.
    const applyChange = useCallback((fresh: Passport) => {
        setPassports(list => list?.map(p => p.id === fresh.id ? fresh : p) ?? list);
    }, []);

    /** Rows for passports that no longer exist, gone from the list and from the
     * selection that was acting on them. */
    const dropPassports = useCallback((deletedIds: string[]) => {
        if (deletedIds.length === 0) return;
        const gone = new Set(deletedIds);
        setPassports(list => list?.filter(p => !gone.has(p.id)) ?? list);
        setSelectedIds(list => list.filter(id => !gone.has(id)));
    }, []);

    const applyDelete = useCallback((deletedId: string) => {
        dropPassports([deletedId]);
        setSelectedId(null);
        setView('dashboard');
    }, [dropPassports]);

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
                onDeleted={applyDelete}
                onLookupUser={onLookupUser}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    if (view === 'generate' && !readOnly) {
        return (
            <PassportGenerator
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
            stockView={stockView}
            onStockViewChange={setStockView}
            selected={selectedIds}
            onSelectedChange={setSelectedIds}
            onBulkDeleted={dropPassports}
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
    stockView: StockView;
    onStockViewChange: (view: StockView) => void;
    selected: string[];
    onSelectedChange: (selected: string[]) => void;
    onBulkDeleted: (passportIds: string[]) => void;
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
                       stockView,
                       onStockViewChange,
                       selected,
                       onSelectedChange,
                       onBulkDeleted,
                       onOpen,
                       onGenerate,
                       onDesigns,
                       showToast,
                       readOnly,
                   }: DashboardProps) => {
    const {isEnglish} = useLanguage();
    const [refreshing, setRefreshing] = useState(false);

    const year = designs.find(d => d.id === designId)?.year;

    const doRefresh = async () => {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    };

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
                            {isEnglish ? '+ Generate Passports' : '+ 生成通行证'}
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

                    {/* The per-status counts live on the table's own tabs; the run
                        total is the one figure they don't carry. */}
                    <div className="admin-stats-tiles admin-section-mb">
                        <StatTile label={isEnglish ? 'Generated' : '已生成'} value={passports?.length ?? 0}/>
                    </div>

                    <PassportSearch designs={designs} onOpen={onOpen} showToast={showToast}/>

                    {loadError ? (
                        <p className="admin-no-results">
                            {isEnglish ? 'Failed to load passports.' : '加载通行证失败。'}
                        </p>
                    ) : passports === null ? (
                        <div className="spinner spinner-centered"/>
                    ) : passports.length === 0 ? (
                        <p className="admin-no-results">
                            {isEnglish
                                ? 'No passports generated from this design yet.'
                                : '此设计尚未生成通行证。'}
                        </p>
                    ) : (
                        <PassportStock
                            passports={passports}
                            year={year}
                            view={stockView}
                            onViewChange={onStockViewChange}
                            selected={selected}
                            onSelectedChange={onSelectedChange}
                            onDeleted={onBulkDeleted}
                            onOpen={onOpen}
                            showToast={showToast}
                            readOnly={readOnly}
                        />
                    )}
                </>
            )}
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

interface PassportGeneratorProps {
    designs: PassportDesign[];
    defaultDesignId: string | null;
    onBack: () => void;
    showToast: ShowToast;
}

/** The run sizes stock is actually printed in, biggest last so it lands on the
 * ceiling the server enforces. */
const COUNT_PRESETS = [25, 50, 100, MAX_PASSPORT_GENERATE];

/** What one generate call handed back, plus the stamp its files are named with. */
interface GeneratedRun {
    designId: string;
    year: number;
    passports: {passportId: string; activationCode: string}[];
    /** Fixed when the call landed, so downloading a second time writes the same
     * filename rather than the current minute's. */
    stamp: string;
}

/**
 * Mint passports and hand over the print files. Nothing ties the passports from
 * one call together afterwards — this screen is the only place their activation
 * keys come back in bulk, and leaving it without exporting means looking each
 * key up one passport at a time.
 */
const PassportGenerator = ({designs, defaultDesignId, onBack, showToast}: PassportGeneratorProps) => {
    const {isEnglish} = useLanguage();
    const [designId, setDesignId] = useState(defaultDesignId ?? designs[0]?.id ?? '');
    const [count, setCount] = useState(50);
    const [busy, setBusy] = useState(false);
    const [issued, setIssued] = useState<GeneratedRun | null>(null);
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

    const exportCsv = (run: GeneratedRun) => {
        downloadBlob(
            buildPassportCsv(run.passports, origin),
            `passports-${run.year}-${run.stamp}-keys.csv`,
        );
        setExported(true);
    };

    const generate = async () => {
        setBusy(true);
        try {
            const res = await callGeneratePassports({designId, count});
            const run: GeneratedRun = {...res.data, stamp: fileStamp()};
            setIssued(run);
            // Save them without being asked. Every way off this screen leaves the
            // keys retrievable only one passport at a time, so the file is written
            // first and the screen becomes a confirmation rather than the only copy
            // of the lot. Only a throw re-arms the warning — a download the browser
            // silently blocks still reads as exported, which is why the banner
            // tells the admin to go and look for the file.
            setExported(false);
            try {
                exportCsv(run);
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
                    {/* What the run is going to be, shown as the thing it makes:
                        the cover it prints, the term it grants, and how many. */}
                    <div className="admin-passport-run">
                        <div className="admin-passport-run-cover">
                            {selectedDesign?.coverImageUrl
                                ? <img src={selectedDesign.coverImageUrl} alt=""/>
                                : <span>{selectedDesign?.year || '—'}</span>}
                        </div>
                        <div className="admin-passport-run-fields">
                            <label className="admin-passport-run-field">
                                <span className="admin-passport-run-label">
                                    {isEnglish ? 'Design' : '设计'}
                                </span>
                                <select className="admin-input" value={designId}
                                        onChange={e => setDesignId(e.target.value)}>
                                    {designs.map(design => (
                                        <option key={design.id}
                                                value={design.id}>{designLabel(design, isEnglish)}</option>
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

                            <div className="admin-passport-run-field">
                                <span className="admin-passport-run-label">
                                    {isEnglish ? 'How many' : '数量'}
                                </span>
                                {/* Stock is printed in round runs, so the sizes
                                    that are actually asked for are one click
                                    rather than a number typed into a box. */}
                                <div className="admin-passport-count">
                                    {COUNT_PRESETS.map(preset => (
                                        <button
                                            key={preset}
                                            type="button"
                                            className={`admin-passport-count-chip${
                                                count === preset ? ' admin-passport-count-chip--on' : ''}`}
                                            onClick={() => setCount(preset)}
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        className="admin-input admin-input--sm admin-passport-count-input"
                                        min={1}
                                        max={MAX_PASSPORT_GENERATE}
                                        value={count}
                                        aria-label={isEnglish
                                            ? `How many passports, 1 to ${MAX_PASSPORT_GENERATE}`
                                            : `生成数量，1 至 ${MAX_PASSPORT_GENERATE}`}
                                        onChange={e => setCount(Math.max(1, Math.min(MAX_PASSPORT_GENERATE, Number(e.target.value) || 1)))}
                                    />
                                    <span className="admin-passport-count-max">
                                        {isEnglish
                                            ? `of ${MAX_PASSPORT_GENERATE} max`
                                            : `上限 ${MAX_PASSPORT_GENERATE}`}
                                    </span>
                                </div>
                            </div>
                        </div>
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
                    {/* The one fact that changes what to do next, beside the
                        button that makes it true. What a code is and what a key
                        is, the next screen shows in two labelled columns. */}
                    <p className="admin-passport-gen-note">
                        {isEnglish
                            ? 'The keys CSV downloads as soon as the passports exist — the next screen is the only one that lists them together. After it, a key is viewed one passport at a time.'
                            : '通行证生成后将立即下载激活码 CSV — 只有下一屏会集中列出这些激活码。此后只能逐本查看。'}
                    </p>
                </>
            ) : (
                <>
                    {/* Saved is an outcome, not a warning, so it stops being
                        yellow the moment the file is on disk. Unsaved keeps the
                        red it has earned. */}
                    <div className={`admin-passport-result admin-passport-result--${
                        exported ? 'saved' : 'unsaved'}`}>
                        <strong className="admin-passport-result-title">
                            {exported
                                ? (isEnglish ? '✓ Keys saved' : '✓ 激活码已保存')
                                : (isEnglish ? 'Download the keys now' : '请立即下载激活码')}
                        </strong>
                        <p className="admin-passport-result-meta">
                            {isEnglish
                                ? `${issued.passports.length} passports · ${issued.year} · ${issuedDesign}`
                                : `${issued.passports.length} 本通行证 · ${issued.year} · ${issuedDesign}`}
                        </p>
                        <p>
                            {exported
                                ? (isEnglish
                                    ? 'The keys CSV is in this device’s downloads folder — check it before packing. Once you leave this screen it is the only list of these passports’ keys.'
                                    : '激活码 CSV 已保存至此设备的下载文件夹 — 请在装袋前确认。离开此页面后，它将是这批激活码的唯一清单。')
                                : (isEnglish
                                    ? 'This is the only screen that lists all of these keys together.'
                                    : '只有此页面会集中列出这些激活码。')}
                        </p>
                    </div>

                    <div className="admin-passport-result-actions">
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
                                `passports-${issued.year}-${issued.stamp}`,
                            )}
                            disabled={!!progress}
                            type="button"
                        >
                            {progress
                                ? (isEnglish ? `Rendering ${progress.done}/${progress.total}…` : `生成中 ${progress.done}/${progress.total}…`)
                                : (isEnglish ? 'Download stickers ZIP' : '下载贴纸 ZIP')}
                        </button>
                        {/* Away from the two downloads: it is the way off the
                            screen, not a third thing to fetch. */}
                        <button
                            className="admin-toggle-btn admin-toggle-cancel admin-passport-result-done"
                            onClick={leave}
                            type="button"
                        >
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </div>

                    {/* Two labelled columns, which is the whole of what a public
                        code and a secret key are — said by showing them rather
                        than in a paragraph on the screen before. */}
                    <div className="admin-passport-keys">
                        <div className="admin-passport-key-row admin-passport-keys-head">
                            <span className="admin-passport-key-code">
                                {isEnglish ? 'Code' : '编号'}
                                {/* Dropped on a phone, where the two labels
                                    together are wider than the row they head. */}
                                <span className="admin-passport-keys-head-where">
                                    {isEnglish ? ' · on the sticker' : ' · 印于贴纸'}
                                </span>
                            </span>
                            <span className="admin-passport-key-secret">
                                {isEnglish ? 'Activation key' : '激活码'}
                                <span className="admin-passport-keys-head-where">
                                    {isEnglish ? ' · on the slip' : ' · 印于纸条'}
                                </span>
                            </span>
                        </div>
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
