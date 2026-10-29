import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fileStamp } from '~/lib/csv';
import { callGeneratePassports, errorMessage } from '~/lib/firebase';
import { MAX_PASSPORT_GENERATE, type PassportDesign, passportName, } from '~/lib/passports';
import { confirmExit, useExitGuard } from '~/lib/useExitGuard';
import { downloadBlob } from '~/lib/zip';
import type { ShowToast } from '../utils';
import { buildPassportCsv, usePassportPngExport } from './passportExport';

interface PassportGeneratorProps {
    designs: PassportDesign[];
    defaultDesignId: string | null;
    onBack: () => void;
    showToast: ShowToast;
}

/** The run sizes stock is printed in, the last being the server's ceiling. */
const COUNT_PRESETS = [25, 50, 100, MAX_PASSPORT_GENERATE];

/** What one generate call handed back, plus the stamp its files are named with. */
interface GeneratedRun {
    designId: string;
    year: number;
    passports: {passportId: string; activationCode: string}[];
    /** Fixed when the call landed, so a second download has the same name. */
    stamp: string;
}

/** How the admin screens tell designs apart: a year can have several. */
export const designLabel = (design: PassportDesign, isEnglish: boolean): string =>
    `${design.year} · ${passportName(design, isEnglish)}`;

/** A picker over every design, each by its year and name. */
export const DesignSelect = ({designs, value, onChange, disabled}: {
    designs: PassportDesign[];
    value: string;
    onChange: (designId: string) => void;
    disabled?: boolean;
}) => {
    const {isEnglish} = useLanguage();
    return (
        <select className="admin-input" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
            {designs.map(design => (
                <option key={design.id} value={design.id}>
                    {designLabel(design, isEnglish)}
                </option>
            ))}
        </select>
    );
};

/** What each passport of the picked design grants, under its picker. */
export const DesignTermHint = ({design}: {design: PassportDesign | undefined}) => {
    const {isEnglish} = useLanguage();
    if (!design) return null;
    return (
        <small className="admin-title-hint">
            {isEnglish
                ? `Each passport grants ${design.termDays} days of membership.`
                : `每本通行证授予 ${design.termDays} 天会员资格。`}
        </small>
    );
};

/**
 * Mint passports and hand over the print files. Nothing ties a run together
 * afterwards, so leaving without exporting means picking them out of the stock
 * table (newest first) for a Keys CSV.
 */
export const PassportGenerator = ({designs, defaultDesignId, onBack, showToast}: PassportGeneratorProps) => {
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

    // Armed while keys exist that aren't saved, covering tab close, reload and
    // admin tab switches as well as Back.
    useExitGuard(!!issued && !exported, isEnglish
        ? 'You haven’t downloaded the activation keys. After leaving, select these passports in the stock table to download them. Leave anyway?'
        : '你还没有下载激活码。离开后，需在库存表中选中这些通行证才能下载。仍要离开吗？');

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
            // Saved unasked, so the screen is a confirmation rather than the only
            // copy. Only a throw re-arms the warning; a download the browser blocks
            // still counts as exported, which is why the banner says to check for
            // the file.
            setExported(false);
            try {
                exportCsv(run);
            } catch {
                showToast(isEnglish
                    ? 'Passports generated, but the keys CSV didn’t download. Use the button below before leaving.'
                    : '通行证已生成，但激活码 CSV 未能下载。请在离开前使用下方按钮下载。', 'warning');
            }
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to generate passports.' : '生成通行证失败。'), 'error');
        } finally {
            setBusy(false);
        }
    };

    // Back asks through the guard, like every other way out.
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
                    {/* The run as what it makes: the cover, the term, and how
                        many. */}
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
                                <DesignSelect designs={designs} value={designId} onChange={setDesignId}/>
                                <DesignTermHint design={selectedDesign}/>
                            </label>

                            <div className="admin-passport-run-field">
                                <span className="admin-passport-run-label">
                                    {isEnglish ? 'How many' : '数量'}
                                </span>
                                {/* Stock is printed in round runs, so the usual
                                    sizes are one click. */}
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
                        button. */}
                    <p className="admin-passport-gen-note">
                        {isEnglish
                            ? 'The keys CSV downloads as soon as the passports exist. To download it again later, select the passports in the stock table and use Keys CSV.'
                            : '通行证生成后将立即下载激活码 CSV。之后如需重新下载，请在库存表中选中这些通行证并使用「激活码 CSV」。'}
                    </p>
                </>
            ) : (
                <>
                    {/* Saved is an outcome, not a warning, so it isn't yellow;
                        unsaved stays red. */}
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
                                    ? 'The keys CSV is in this device’s downloads folder — check it before packing. It can be downloaded again from the stock table’s Keys CSV.'
                                    : '激活码 CSV 已保存至此设备的下载文件夹 — 请在装袋前确认。之后也可在库存表中通过「激活码 CSV」重新下载。')
                                : (isEnglish
                                    ? 'This is the only screen that lists this run’s keys on its own.'
                                    : '只有此页面会单独列出这一批的激活码。')}
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
                        {/* Apart from the downloads: it's the way off the
                            screen. */}
                        <button
                            className="admin-toggle-btn admin-toggle-cancel admin-passport-result-done"
                            onClick={leave}
                            type="button"
                        >
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </div>

                    {/* Public code and secret key, as two labelled columns. */}
                    <div className="admin-passport-keys">
                        <div className="admin-passport-key-row admin-passport-keys-head">
                            <span className="admin-passport-key-code">
                                {isEnglish ? 'Code' : '编号'}
                                {/* Dropped on a phone, where both labels don't
                                    fit. */}
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
