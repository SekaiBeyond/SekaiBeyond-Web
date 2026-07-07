import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteParkingRate, callSaveParkingRate } from '~/lib/firebase';
import { type ParkingRate, RATE_COLOR_PRESETS, rateColorById } from '~/lib/parkingRates';
import { type CardHighlightHandle, useCardHighlight } from './useCardHighlight';

/** Preset swatches + a native picker for custom colors. `value` is always a hex color. */
const RateColorField = ({value, onChange, isEnglish}: {
    value: string;
    onChange: (color: string) => void;
    isEnglish: boolean;
}) => (
    <div className="admin-field-section">
        <span className="admin-field-label">{isEnglish ? 'Map Color' : '地图颜色'}</span>
        <div className="admin-rate-color-row">
            {RATE_COLOR_PRESETS.map(c => (
                <button
                    key={c}
                    type="button"
                    className={`admin-rate-swatch${value.toLowerCase() === c ? ' is-active' : ''}`}
                    style={{background: c}}
                    onClick={() => onChange(c)}
                    aria-label={c}
                />
            ))}
            <input
                type="color"
                className="admin-rate-color-input"
                value={value}
                onChange={e => onChange(e.target.value)}
                title={isEnglish ? 'Custom color' : '自定义颜色'}
            />
        </div>
        <p className="admin-helper-text">
            {isEnglish
                ? 'Lots on this rate tier use this color on the parking maps.'
                : '使用此费率档位的停车场将在停车地图上显示此颜色。'}
        </p>
    </div>
);

interface ParkingRatesTabProps {
    parkingRates: ParkingRate[];
    refreshParkingRates: () => Promise<void>;
    /** Refreshed alongside rates because deleting a rate unlinks it from any lots. */
    refreshParkingLots: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ParkingRatesTab = forwardRef<CardHighlightHandle, ParkingRatesTabProps>((
    {parkingRates, refreshParkingRates, refreshParkingLots, showToast, readOnly = false}, ref) => {
    const {isEnglish} = useLanguage();
    const {highlightedId, registerCard, highlight} = useCardHighlight();
    useImperativeHandle(ref, () => ({highlight}));
    const [showCreate, setShowCreate] = useState(false);
    const [labelEn, setLabelEn] = useState('');
    const [labelCn, setLabelCn] = useState('');
    const [color, setColor] = useState('');
    const [saving, setSaving] = useState(false);

    const [editingRate, setEditingRate] = useState<ParkingRate | null>(null);
    const [editLabelEn, setEditLabelEn] = useState('');
    const [editLabelCn, setEditLabelCn] = useState('');
    const [editColor, setEditColor] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // What the maps actually render per rate: the pinned color or its preset fallback.
    const colorById = useMemo(() => rateColorById(parkingRates), [parkingRates]);
    // Default for a new rate: the next unused-looking preset, so tiers differ out of the box.
    const nextPreset = RATE_COLOR_PRESETS[parkingRates.length % RATE_COLOR_PRESETS.length];

    const createRate = async () => {
        if (!labelEn.trim()) return;
        setSaving(true);
        try {
            await callSaveParkingRate({
                labelEn: labelEn.trim(),
                labelCn: labelCn.trim(),
                color: color || nextPreset,
            });
            await refreshParkingRates();
            setLabelEn('');
            setLabelCn('');
            setColor('');
            setShowCreate(false);
            showToast(isEnglish ? 'Rate created.' : '费率已创建。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to create rate.' : '创建费率失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (rate: ParkingRate) => {
        setEditingRate(rate);
        setEditLabelEn(rate.labelEn);
        setEditLabelCn(rate.labelCn);
        // Surface the effective color so saving pins what the map already shows.
        setEditColor(rate.color || colorById[rate.id]);
    };

    const saveEdit = async () => {
        if (!editingRate || !editLabelEn.trim()) return;
        setSavingEdit(true);
        try {
            await callSaveParkingRate({
                rateId: editingRate.id,
                labelEn: editLabelEn.trim(),
                labelCn: editLabelCn.trim(),
                color: editColor,
            });
            await refreshParkingRates();
            setEditingRate(null);
            showToast(isEnglish ? 'Rate updated.' : '费率已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save rate.' : '保存费率失败。', 'error');
        } finally {
            setSavingEdit(false);
        }
    };

    const deleteRate = async (rate: ParkingRate) => {
        if (!confirm(isEnglish
            ? `Delete rate "${rate.labelEn}"? Lots using this rate will show no rate.`
            : `删除费率"${rate.labelEn}"？使用此费率的停车场将不显示费率。`
        )) return;
        setDeletingId(rate.id);
        try {
            const res = await callDeleteParkingRate({rateId: rate.id});
            await Promise.all([refreshParkingRates(), refreshParkingLots()]);
            if (editingRate?.id === rate.id) setEditingRate(null);
            const unlinkedCount = res.data.unlinkedFrom;
            const msg = unlinkedCount > 0
                ? (isEnglish
                    ? `Rate deleted. Unlinked from ${unlinkedCount} lot${unlinkedCount === 1 ? '' : 's'}.`
                    : `费率已删除，已从 ${unlinkedCount} 个停车场解除关联。`)
                : (isEnglish ? 'Rate deleted.' : '费率已删除。');
            showToast(msg, 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete rate.' : '删除费率失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="admin-section">
            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'Rate tiers are shared across parking lots. Define them once here, then assign one to each lot.'
                    : '费率档位为多个停车场共享。在此处统一定义后，即可为每个停车场分配。'}
            </p>

            {!readOnly && (showCreate ? (
                <div className="admin-create-badge-form">
                    <h4 className="admin-badges-title">
                        {isEnglish ? 'Create New Rate' : '创建新费率'}
                    </h4>
                    <div className="admin-form-grid">
                        <label>
                            <span>{isEnglish ? 'Rate (English)' : '费率（英文）'}</span>
                            <input
                                value={labelEn}
                                onChange={e => setLabelEn(e.target.value)}
                                className="admin-input"
                                placeholder="e.g. $5.00 hourly, $21.00 daily"
                            />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Rate (Chinese)' : '费率（中文）'}</span>
                            <input
                                value={labelCn}
                                onChange={e => setLabelCn(e.target.value)}
                                className="admin-input"
                                placeholder="例如：每小时 $5.00，每日 $21.00"
                            />
                        </label>
                    </div>
                    <RateColorField value={color || nextPreset} onChange={setColor} isEnglish={isEnglish}/>
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={createRate}
                            disabled={saving || !labelEn.trim()}
                        >
                            {saving
                                ? (isEnglish ? 'Creating...' : '创建中...')
                                : (isEnglish ? 'Create Rate' : '创建费率')}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={() => setShowCreate(false)}>
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            ) : (
                <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => setShowCreate(true)}>
                    {isEnglish ? '+ New Rate' : '+ 新建费率'}
                </button>
            ))}

            {parkingRates.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No rates yet.' : '暂无费率。'}</p>
            )}

            <div className="admin-event-grid">
                {parkingRates.map(rate => (
                    <div
                        key={rate.id}
                        ref={registerCard(rate.id)}
                        className={`admin-event-card admin-tag-card${highlightedId === rate.id ? ' admin-card-highlight' : ''}`}
                    >
                        <div className="admin-event-card-info admin-tag-card-info">
                            {editingRate?.id === rate.id ? (
                                <>
                                    <input
                                        value={editLabelEn}
                                        onChange={e => setEditLabelEn(e.target.value)}
                                        className="admin-input admin-tag-input"
                                        placeholder={isEnglish ? 'English rate' : '英文费率'}
                                    />
                                    <input
                                        value={editLabelCn}
                                        onChange={e => setEditLabelCn(e.target.value)}
                                        className="admin-input admin-tag-input"
                                        placeholder={isEnglish ? 'Chinese rate' : '中文费率'}
                                    />
                                    <RateColorField value={editColor} onChange={setEditColor} isEnglish={isEnglish}/>
                                    <div className="admin-tag-actions">
                                        <button
                                            className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                                            onClick={saveEdit}
                                            disabled={savingEdit || !editLabelEn.trim()}
                                        >
                                            {savingEdit
                                                ? (isEnglish ? 'Saving...' : '保存中...')
                                                : (isEnglish ? 'Save' : '保存')}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                                            onClick={() => setEditingRate(null)}
                                        >
                                            {isEnglish ? 'Cancel' : '取消'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="admin-event-card-title">
                                        <span
                                            className="admin-rate-dot"
                                            style={{background: colorById[rate.id]}}
                                            title={isEnglish ? 'Marker color on the parking maps' : '停车地图上的标记颜色'}
                                        />
                                        {rate.labelEn}
                                    </span>
                                    {rate.labelCn && (
                                        <span className="admin-event-card-date">{rate.labelCn}</span>
                                    )}
                                    {!readOnly && (
                                        <div className="admin-tag-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => openEdit(rate)}
                                            >
                                                {isEnglish ? 'Edit' : '编辑'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                                onClick={() => deleteRate(rate)}
                                                disabled={deletingId === rate.id}
                                            >
                                                {deletingId === rate.id
                                                    ? (isEnglish ? 'Deleting...' : '删除中...')
                                                    : (isEnglish ? 'Delete' : '删除')}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});
ParkingRatesTab.displayName = 'ParkingRatesTab';
