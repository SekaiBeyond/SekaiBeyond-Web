import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fileStamp } from '~/lib/csv';
import { callGeneratePassports, errorMessage } from '~/lib/firebase';
import { MAX_PASSPORT_GENERATE, PASSPORT_NOTE_MAX, type PassportDesign, passportName, } from '~/lib/passports';
import { confirmExit, useExitGuard } from '~/lib/useExitGuard';
import { downloadBlob } from '~/lib/download';
import type { ShowToast } from '../utils';
import { buildPassportCsv, usePassportPngExport } from './passportExport';
import { ToolHeader } from '../ToolHeader';

interface PassportGeneratorProps {
    designs: PassportDesign[];
    defaultDesignId: string | null;
    onBack: () => void;
    showToast: ShowToast;
}

const COUNT_PRESETS = [25, 50, 100, MAX_PASSPORT_GENERATE];

interface GeneratedRun {
    designId: string;
    year: number;
    passports: {passportId: string; activationCode: string}[];
    note: string;
    stamp: string;
}

export const designLabel = (design: PassportDesign, isEnglish: boolean): string =>
    `${design.year} · ${passportName(design, isEnglish)}`;

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

export const PassportNoteField = ({value, onChange, disabled, className, labelClassName}: {
    value: string;
    onChange: (note: string) => void;
    disabled?: boolean;
    className: string;
    labelClassName?: string;
}) => {
    const {isEnglish} = useLanguage();
    return (
        <label className={className}>
            <span className={labelClassName}>
                {isEnglish ? 'Note' : '备注'}
                <span className="admin-passport-optional">{isEnglish ? ' · optional' : ' · 选填'}</span>
            </span>
            <input
                className="admin-input"
                value={value}
                maxLength={PASSPORT_NOTE_MAX}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                placeholder={isEnglish
                    ? 'Why they’re being made, e.g. giveaway prizes, a replacement, staff comps'
                    : '生成原因，例如：抽奖奖品、补发、工作人员赠送'}
            />
            <small className="admin-title-hint">
                {isEnglish
                    ? 'Saved on each passport. Only staff see it; you can change it later on the passport’s page.'
                    : '保存在每本通行证上，仅工作人员可见；之后可在通行证页面修改。'}
            </small>
        </label>
    );
};

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

export const PassportGenerator = ({designs, defaultDesignId, onBack, showToast}: PassportGeneratorProps) => {
    const {isEnglish} = useLanguage();
    const [designId, setDesignId] = useState(defaultDesignId ?? designs[0]?.id ?? '');
    const [count, setCount] = useState(50);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [issued, setIssued] = useState<GeneratedRun | null>(null);
    const [exported, setExported] = useState(false);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const selectedDesign = designs.find(d => d.id === designId);
    const issuedDesign = passportName(designs.find(d => d.id === issued?.designId), isEnglish);

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
            const trimmed = note.trim();
            const res = await callGeneratePassports({designId, count, note: trimmed});
            const run: GeneratedRun = {...res.data, note: trimmed, stamp: fileStamp()};
            setIssued(run);
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

    const leave = () => {
        if (confirmExit()) onBack();
    };

    return (
        <div className="admin-section">
            <ToolHeader title={isEnglish ? 'Generate Passports' : '生成通行证'}
                        back={isEnglish ? 'Back to Passports' : '返回通行证'} onBack={leave}/>

            {!issued ? (
                <>
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

                            <PassportNoteField
                                value={note}
                                onChange={setNote}
                                className="admin-passport-run-field"
                                labelClassName="admin-passport-run-label"
                            />
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
                    <p className="admin-passport-gen-note">
                        {isEnglish
                            ? 'The keys CSV downloads as soon as the passports exist. To download it again later, select the passports in the stock table and use Keys CSV.'
                            : '通行证生成后将立即下载激活码 CSV。之后如需重新下载，请在库存表中选中这些通行证并使用「激活码 CSV」。'}
                    </p>
                </>
            ) : (
                <>
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
                        {issued.note && (
                            <p className="admin-passport-result-meta">
                                {isEnglish ? `Note: ${issued.note}` : `备注：${issued.note}`}
                            </p>
                        )}
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
                        <button
                            className="admin-toggle-btn admin-toggle-cancel admin-passport-result-done"
                            onClick={leave}
                            type="button"
                        >
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </div>

                    <div className="admin-passport-keys">
                        <div className="admin-passport-key-row admin-passport-keys-head">
                            <span className="admin-passport-key-code">
                                {isEnglish ? 'Code' : '编号'}
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
