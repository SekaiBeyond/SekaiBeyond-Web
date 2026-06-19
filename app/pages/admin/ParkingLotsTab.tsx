import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteParkingLot, callSaveParkingLot } from '~/lib/firebase';
import type { ParkingLot } from '~/lib/parkingLots';
import { UW_CAMPUS_CENTER } from '~/lib/venues';
import { MapPicker } from './MapPicker';

const LOT_TYPES: ParkingLot['type'][] = ['general', 'disabled', 'garage'];

interface LotDraft {
    name: string;
    nameCn: string;
    type: ParkingLot['type'];
    lat: number;
    lng: number;
    descriptionEn: string;
    descriptionCn: string;
}

function lotToDraft(lot: ParkingLot): LotDraft {
    return {
        name: lot.name,
        nameCn: lot.nameCn,
        type: lot.type,
        lat: lot.lat,
        lng: lot.lng,
        descriptionEn: lot.descriptionEn,
        descriptionCn: lot.descriptionCn,
    };
}

function emptyDraft(): LotDraft {
    return {
        name: '',
        nameCn: '',
        type: 'general',
        lat: UW_CAMPUS_CENTER.lat,
        lng: UW_CAMPUS_CENTER.lng,
        descriptionEn: '',
        descriptionCn: '',
    };
}

interface ParkingLotsTabProps {
    parkingLots: ParkingLot[];
    refreshParkingLots: () => Promise<void>;
    refreshVenues: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ParkingLotsTab = ({
                                   parkingLots, refreshParkingLots, refreshVenues, showToast, readOnly = false,
                               }: ParkingLotsTabProps) => {
    const {isEnglish} = useLanguage();
    const [showCreate, setShowCreate] = useState(false);
    const [createDraft, setCreateDraft] = useState<LotDraft>(emptyDraft());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<LotDraft>(emptyDraft());
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const validateDraft = (draft: LotDraft): string | null => {
        if (!draft.name.trim()) return isEnglish ? 'English name is required.' : '英文名称是必填项。';
        return null;
    };

    const buildPayload = (draft: LotDraft) => ({
        name: draft.name.trim(),
        nameCn: draft.nameCn.trim(),
        type: draft.type,
        lat: draft.lat,
        lng: draft.lng,
        descriptionEn: draft.descriptionEn.trim(),
        descriptionCn: draft.descriptionCn.trim(),
    });

    const createLot = async () => {
        const err = validateDraft(createDraft);
        if (err) {
            showToast(err, 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveParkingLot(buildPayload(createDraft));
            await refreshParkingLots();
            setCreateDraft(emptyDraft());
            setShowCreate(false);
            showToast(isEnglish ? 'Parking lot created.' : '停车场已创建。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to create parking lot.' : '创建停车场失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (lot: ParkingLot) => {
        setEditingId(lot.id);
        setEditDraft(lotToDraft(lot));
    };

    const saveEdit = async () => {
        if (!editingId) return;
        const err = validateDraft(editDraft);
        if (err) {
            showToast(err, 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveParkingLot({lotId: editingId, ...buildPayload(editDraft)});
            await refreshParkingLots();
            setEditingId(null);
            showToast(isEnglish ? 'Parking lot updated.' : '停车场已更新。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save parking lot.' : '保存停车场失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const deleteLot = async (lot: ParkingLot) => {
        if (!confirm(isEnglish
            ? `Delete parking lot "${lot.name}"? It will be unlinked from any venues that reference it.`
            : `删除停车场"${lot.name}"？任何关联此停车场的场地将自动解除关联。`
        )) return;
        setDeletingId(lot.id);
        try {
            const res = await callDeleteParkingLot({lotId: lot.id});
            await Promise.all([refreshParkingLots(), refreshVenues()]);
            if (editingId === lot.id) setEditingId(null);
            const unlinkedCount = res.data.unlinkedFrom;
            const msg = unlinkedCount > 0
                ? (isEnglish
                    ? `Parking lot deleted. Unlinked from ${unlinkedCount} venue${unlinkedCount === 1 ? '' : 's'}.`
                    : `停车场已删除，已从 ${unlinkedCount} 个场地解除关联。`)
                : (isEnglish ? 'Parking lot deleted.' : '停车场已删除。');
            showToast(msg, 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete parking lot.' : '删除停车场失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="admin-section">
            <p className="admin-helper-text" style={{marginTop: '4px', marginBottom: '12px'}}>
                {isEnglish
                    ? 'Parking lots are shared across venues. Link them to a venue from the Venues section.'
                    : '停车场为多个场地共享。请在"场地"区块将其关联到场地。'}
            </p>

            {!readOnly && (showCreate ? (
                <div className="admin-create-badge-form">
                    <h4 className="admin-badges-title">{isEnglish ? 'Create New Parking Lot' : '创建新停车场'}</h4>
                    <LotForm draft={createDraft} setDraft={setCreateDraft} isEnglish={isEnglish}/>
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={createLot}
                            disabled={saving}
                        >
                            {saving
                                ? (isEnglish ? 'Creating...' : '创建中...')
                                : (isEnglish ? 'Create Lot' : '创建停车场')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                setShowCreate(false);
                                setCreateDraft(emptyDraft());
                            }}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            ) : (
                <button className="admin-generate-btn admin-section-mb" onClick={() => setShowCreate(true)}>
                    {isEnglish ? '+ New Parking Lot' : '+ 新建停车场'}
                </button>
            ))}

            {parkingLots.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No parking lots yet.' : '暂无停车场。'}</p>
            )}

            <div className="admin-event-grid">
                {parkingLots.map(lot => {
                    const typeLabel = isEnglish
                        ? (lot.type === 'disabled' ? 'Disabled' : lot.type === 'garage' ? 'Garage' : 'General')
                        : (lot.type === 'disabled' ? '无障碍' : lot.type === 'garage' ? '停车库' : '普通');
                    return (
                        <div
                            key={lot.id}
                            className={`admin-event-card${editingId === lot.id ? ' admin-event-card-editing' : ''}`}
                        >
                            <div className="admin-event-card-info">
                                {editingId === lot.id ? (
                                    <>
                                        <LotForm draft={editDraft} setDraft={setEditDraft} isEnglish={isEnglish}/>
                                        <div className="admin-tag-actions admin-mt-12">
                                            <button
                                                className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                                                onClick={saveEdit}
                                                disabled={saving}
                                            >
                                                {saving
                                                    ? (isEnglish ? 'Saving...' : '保存中...')
                                                    : (isEnglish ? 'Save' : '保存')}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                                                onClick={() => setEditingId(null)}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <span className="admin-event-card-title">{lot.name}</span>
                                        {lot.nameCn && (
                                            <span className="admin-event-card-date">{lot.nameCn}</span>
                                        )}
                                        <span className="admin-helper-text" style={{display: 'block', marginTop: 4}}>
                                            {typeLabel}
                                        </span>
                                        {!readOnly && (
                                            <div className="admin-tag-actions">
                                                <button
                                                    className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                    onClick={() => openEdit(lot)}
                                                >
                                                    {isEnglish ? 'Edit' : '编辑'}
                                                </button>
                                                <button
                                                    className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                                    onClick={() => deleteLot(lot)}
                                                    disabled={deletingId === lot.id}
                                                >
                                                    {deletingId === lot.id
                                                        ? (isEnglish ? 'Deleting...' : '删除中...')
                                                        : (isEnglish ? 'Delete' : '删除')}
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface LotFormProps {
    draft: LotDraft;
    setDraft: (updater: (prev: LotDraft) => LotDraft) => void;
    isEnglish: boolean;
}

const LotForm = ({draft, setDraft, isEnglish}: LotFormProps) => (
    <>
        <div className="admin-form-grid">
            <label>
                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                <input
                    value={draft.name}
                    onChange={e => setDraft(prev => ({...prev, name: e.target.value}))}
                    className="admin-search-input"
                    placeholder="e.g. N24 General Parking"
                />
            </label>
            <label>
                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                <input
                    value={draft.nameCn}
                    onChange={e => setDraft(prev => ({...prev, nameCn: e.target.value}))}
                    className="admin-search-input"
                    placeholder="例如：N24 普通停车场"
                />
            </label>
            <label>
                <span>{isEnglish ? 'Type' : '类型'}</span>
                <select
                    value={draft.type}
                    onChange={e => setDraft(prev => ({...prev, type: e.target.value as ParkingLot['type']}))}
                    className="admin-search-input"
                >
                    {LOT_TYPES.map(t => (
                        <option key={t} value={t}>
                            {isEnglish
                                ? (t === 'disabled' ? 'Disabled' : t === 'garage' ? 'Garage' : 'General')
                                : (t === 'disabled' ? '无障碍' : t === 'garage' ? '停车库' : '普通')}
                        </option>
                    ))}
                </select>
            </label>
        </div>

        <div className="admin-field-section">
            <span className="admin-field-label">
                {isEnglish ? 'Lot Location' : '停车场位置'}
            </span>
            <MapPicker
                value={{lat: draft.lat, lng: draft.lng}}
                onChange={({lat, lng}) => setDraft(prev => ({...prev, lat, lng}))}
            />
        </div>

        <div className="admin-field-section">
            <span className="admin-field-label">{isEnglish ? 'Description' : '描述'}</span>
            <p className="admin-helper-text admin-field-hint">
                {isEnglish
                    ? 'Shown to visitors on the parking guide — add directions, the nearest entrance, or a helpful tip.'
                    : '将显示在停车指南中 — 可填写方向、最近的入口或实用提示。'}
            </p>
            <div className="admin-form-grid">
                <label>
                    <span>{isEnglish ? 'English' : '英文'}</span>
                    <textarea
                        value={draft.descriptionEn}
                        onChange={e => setDraft(prev => ({...prev, descriptionEn: e.target.value}))}
                        className="admin-search-input admin-textarea"
                        maxLength={1000}
                        placeholder="e.g. Enter from Stevens Way; a short, well-lit walk to the main entrance."
                    />
                    <small className={`admin-char-count${draft.descriptionEn.length > 900 ? ' is-near-limit' : ''}`}>
                        {draft.descriptionEn.length}/1000
                    </small>
                </label>
                <label>
                    <span>{isEnglish ? 'Chinese' : '中文'}</span>
                    <textarea
                        value={draft.descriptionCn}
                        onChange={e => setDraft(prev => ({...prev, descriptionCn: e.target.value}))}
                        className="admin-search-input admin-textarea"
                        maxLength={1000}
                        placeholder="例如：从 Stevens Way 进入，步行很短即到正门，沿途照明良好。"
                    />
                    <small className={`admin-char-count${draft.descriptionCn.length > 900 ? ' is-near-limit' : ''}`}>
                        {draft.descriptionCn.length}/1000
                    </small>
                </label>
            </div>
        </div>
    </>
);
