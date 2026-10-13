import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGeneratePassports } from '~/lib/firebase';
import { MAX_PASSPORT_GENERATE, type PassportDesign, passportName, } from '~/lib/passports';
import { confirmExit, useExitGuard } from '~/lib/useExitGuard';
import { downloadBlob } from '~/lib/zip';
import type { ShowToast } from '../utils';
import { buildPassportCsv, fileStamp, usePassportPngExport } from './passportExport';

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

/** How the admin screens tell designs apart: a year can have several. */
export const designLabel = (design: PassportDesign, isEnglish: boolean): string =>
    `${design.year} · ${passportName(design, isEnglish)}`;

/**
 * Mint passports and hand over the print files. Nothing ties the passports from
 * one call together afterwards, so leaving without exporting means finding them
 * again in the stock table — newest first, so at the top — and selecting them for
 * a Keys CSV.
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

    // Armed the moment keys exist that aren't on disk yet. Covers closing the
    // tab, reloading, and switching admin tabs — none of which the Back button's
    // confirm ever saw.
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
            // Save them without being asked. Off this screen they have to be picked
            // out of the stock table again, so the file is written first and the
            // screen becomes a confirmation rather than the only copy of the lot.
            // Only a throw re-arms the warning — a download the browser silently
            // blocks still reads as exported, which is why the banner tells the
            // admin to go and look for the file.
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
                                <select
                                    className="admin-input"
                                    value={designId}
                                    onChange={e => setDesignId(e.target.value)}
                                >
                                    {designs.map(design => (
                                        <option key={design.id} value={design.id}>
                                            {designLabel(design, isEnglish)}
                                        </option>
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
                            ? 'The keys CSV downloads as soon as the passports exist. To download it again later, select the passports in the stock table and use Keys CSV.'
                            : '通行证生成后将立即下载激活码 CSV。之后如需重新下载，请在库存表中选中这些通行证并使用「激活码 CSV」。'}
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
