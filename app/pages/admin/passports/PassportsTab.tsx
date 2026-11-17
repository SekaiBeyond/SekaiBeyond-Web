import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fetchPassportsByDesign, type Passport, type PassportDesign, usePassportDesigns, } from '~/lib/passports';
import { StatTile } from '../StatTile';
import type { ShowToast } from '../utils';
import { PassportDesignsSection } from './PassportDesignsSection';
import { PassportDetail } from './PassportDetail';
import { PassportEmailer } from './PassportEmailer';
import { DesignSelect, PassportGenerator } from './PassportGenerator';
import { PassportSearch } from './PassportSearch';
import { INITIAL_STOCK_VIEW, PassportStock, type StockView } from './PassportStock';
import { RefreshButton, ToolHeader } from '../ToolHeader';

type View = 'dashboard' | 'generate' | 'email' | 'detail' | 'designs';

interface PassportsTabProps {
    onLookupUser: (uid: string) => void;
    showToast: ShowToast;
    readOnly: boolean;
}

export interface PassportsTabHandle {
    openPassport: (id: string) => void;
}

export const PassportsTab = forwardRef<PassportsTabHandle, PassportsTabProps>(({
                                                                                   onLookupUser,
                                                                                   showToast,
                                                                                   readOnly,
                                                                               }, ref) => {
    const {designs, loading: designsLoading, refresh: refreshDesigns} = usePassportDesigns();

    const [view, setView] = useState<View>('dashboard');
    const [designId, setDesignId] = useState<string | null>(null);
    const [passports, setPassports] = useState<Passport[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
        openPassport: (id: string) => {
            setSelectedId(id);
            setView('detail');
        },
    }));
    const [stockView, setStockView] = useState<StockView>(INITIAL_STOCK_VIEW);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    useEffect(() => {
        if (designs.length === 0) return;
        if (designId === null || !designs.some(d => d.id === designId)) setDesignId(designs[0].id);
    }, [designs, designId]);

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

    const applyChange = useCallback((fresh: Passport) => {
        setPassports(list => list?.map(p => p.id === fresh.id ? fresh : p) ?? list);
    }, []);

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

    if (view === 'email' && !readOnly) {
        return (
            <PassportEmailer
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
            onEmail={() => setView('email')}
            onDesigns={() => setView('designs')}
            showToast={showToast}
            readOnly={readOnly}
        />
    );
});

PassportsTab.displayName = 'PassportsTab';

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
    onEmail: () => void;
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
                       onEmail,
                       onDesigns,
                       showToast,
                       readOnly,
                   }: DashboardProps) => {
    const {isEnglish} = useLanguage();

    const year = designs.find(d => d.id === designId)?.year;

    return (
        <div className="admin-section">
            <ToolHeader title={isEnglish ? 'Passports' : '通行证'}>
                <div className="admin-btn-row">
                    <RefreshButton onClick={onRefresh}/>
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={onDesigns}>
                        {isEnglish ? 'Designs' : '设计'}
                    </button>
                    {!readOnly && (
                        <button
                            className="admin-toggle-btn admin-toggle-edit"
                            onClick={onEmail}
                            disabled={designs.length === 0}
                            title={designs.length === 0
                                ? (isEnglish ? 'Create a design first' : '请先创建设计')
                                : undefined}
                        >
                            {isEnglish ? 'Email Passports' : '邮件发送通行证'}
                        </button>
                    )}
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
            </ToolHeader>

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
                            <DesignSelect designs={designs} value={designId ?? ''} onChange={setDesignId}/>
                        </label>
                    </div>

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
