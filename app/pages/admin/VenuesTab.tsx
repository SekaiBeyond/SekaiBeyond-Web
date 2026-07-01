import { forwardRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteVenue, callSaveVenue } from '~/lib/firebase';
import { lotBadgeChar, lotTypeLabel, type ParkingLot } from '~/lib/parkingLots';
import type { Venue, VenueLotLink } from '~/lib/venues';
import { UW_CAMPUS_CENTER } from '~/lib/venues';
import { MapPicker } from './MapPicker';
import { type CardHighlightHandle, useCardHighlight } from './useCardHighlight';

interface VenueDraft {
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    parkingLots: VenueLotLink[];
}

function venueToDraft(v: Venue): VenueDraft {
    return {
        nameEn: v.nameEn,
        nameCn: v.nameCn,
        lat: v.lat,
        lng: v.lng,
        parkingLots: v.parkingLots.map(l => ({...l})),
    };
}

function emptyDraft(): VenueDraft {
    return {
        nameEn: '',
        nameCn: '',
        lat: UW_CAMPUS_CENTER.lat,
        lng: UW_CAMPUS_CENTER.lng,
        parkingLots: [],
    };
}

interface VenuesTabProps {
    venues: Venue[];
    parkingLots: ParkingLot[];
    refreshVenues: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const VenuesTab = forwardRef<CardHighlightHandle, VenuesTabProps>((
    {venues, parkingLots, refreshVenues, showToast, readOnly = false}, ref) => {
    const {isEnglish} = useLanguage();
    const {highlightedId, registerCard} = useCardHighlight(ref);
    const [showCreate, setShowCreate] = useState(false);
    const [createDraft, setCreateDraft] = useState<VenueDraft>(emptyDraft());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<VenueDraft>(emptyDraft());
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const validateDraft = (draft: VenueDraft): string | null => {
        if (!draft.nameEn.trim()) return isEnglish ? 'English name is required.' : '英文名称是必填项。';
        const ids = new Set<string>();
        for (const link of draft.parkingLots) {
            if (!link.lotId) return isEnglish ? 'Every linked lot must reference a parking lot.' : '每个关联停车场必须选择一个停车场。';
            if (ids.has(link.lotId)) return isEnglish ? `Duplicate lot link ("${link.lotId}").` : `重复的停车场关联（"${link.lotId}"）。`;
            ids.add(link.lotId);
        }
        return null;
    };

    const createVenue = async () => {
        const err = validateDraft(createDraft);
        if (err) {
            showToast(err, 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveVenue({
                nameEn: createDraft.nameEn.trim(),
                nameCn: createDraft.nameCn.trim(),
                lat: createDraft.lat,
                lng: createDraft.lng,
                parkingLots: createDraft.parkingLots,
            });
            await refreshVenues();
            setCreateDraft(emptyDraft());
            setShowCreate(false);
            showToast(isEnglish ? 'Venue created.' : '场地已创建。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to create venue.' : '创建场地失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (venue: Venue) => {
        setEditingId(venue.id);
        setEditDraft(venueToDraft(venue));
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
            await callSaveVenue({
                venueId: editingId,
                nameEn: editDraft.nameEn.trim(),
                nameCn: editDraft.nameCn.trim(),
                lat: editDraft.lat,
                lng: editDraft.lng,
                parkingLots: editDraft.parkingLots,
            });
            await refreshVenues();
            setEditingId(null);
            showToast(isEnglish ? 'Venue updated.' : '场地已更新。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save venue.' : '保存场地失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const deleteVenue = async (venue: Venue) => {
        if (!confirm(isEnglish
            ? `Delete venue "${venue.nameEn}"? Events at this location will lose their parking guide.`
            : `删除场地"${venue.nameEn}"？此场地的活动将失去停车指南。`
        )) return;
        setDeletingId(venue.id);
        try {
            await callDeleteVenue({venueId: venue.id});
            await refreshVenues();
            if (editingId === venue.id) setEditingId(null);
            showToast(isEnglish ? 'Venue deleted.' : '场地已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete venue.' : '删除场地失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="admin-section">
            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'Venues power the parking guide. Each venue links to one or more parking lots (managed in the Parking Lots section). Pick a venue for an event from the Venue selector in the event editor to give it a parking guide.'
                    : '场地数据用于停车指南。每个场地关联一个或多个停车场（在停车场区块管理）。在活动编辑器的“场地”选择器中为活动选择场地，即可为其生成停车指南。'}
            </p>

            {!readOnly && (showCreate ? (
                <div className="admin-create-badge-form">
                    <h4 className="admin-badges-title">{isEnglish ? 'Create New Venue' : '创建新场地'}</h4>
                    <VenueForm
                        draft={createDraft}
                        setDraft={setCreateDraft}
                        availableLots={parkingLots}
                        isEnglish={isEnglish}
                    />
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={createVenue}
                            disabled={saving}
                        >
                            {saving
                                ? (isEnglish ? 'Creating...' : '创建中...')
                                : (isEnglish ? 'Create Venue' : '创建场地')}
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
                <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => setShowCreate(true)}>
                    {isEnglish ? '+ New Venue' : '+ 新建场地'}
                </button>
            ))}

            {venues.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No venues yet.' : '暂无场地。'}</p>
            )}

            <div className="admin-event-grid">
                {venues.map(venue => (
                    <div
                        key={venue.id}
                        ref={registerCard(venue.id)}
                        className={`admin-event-card${editingId === venue.id ? ' admin-event-card-editing' : ''}${highlightedId === venue.id ? ' admin-card-highlight' : ''}`}
                    >
                        <div className="admin-event-card-info">
                            {editingId === venue.id ? (
                                <>
                                    <VenueForm
                                        draft={editDraft}
                                        setDraft={setEditDraft}
                                        availableLots={parkingLots}
                                        isEnglish={isEnglish}
                                    />
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
                                    <span className="admin-event-card-title">{venue.nameEn}</span>
                                    {venue.nameCn && (
                                        <span className="admin-event-card-date">{venue.nameCn}</span>
                                    )}
                                    <span className="admin-helper-text admin-card-meta">
                                        {isEnglish
                                            ? `${venue.parkingLots.length} parking lot${venue.parkingLots.length === 1 ? '' : 's'}`
                                            : `${venue.parkingLots.length} 个停车场`}
                                    </span>
                                    {!readOnly && (
                                        <div className="admin-tag-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => openEdit(venue)}
                                            >
                                                {isEnglish ? 'Edit' : '编辑'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                                onClick={() => deleteVenue(venue)}
                                                disabled={deletingId === venue.id}
                                            >
                                                {deletingId === venue.id
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
VenuesTab.displayName = 'VenuesTab';

interface VenueFormProps {
    draft: VenueDraft;
    setDraft: (updater: (prev: VenueDraft) => VenueDraft) => void;
    availableLots: ParkingLot[];
    isEnglish: boolean;
}

const VenueForm = ({draft, setDraft, availableLots, isEnglish}: VenueFormProps) => {
    const updateLink = (index: number, patch: Partial<VenueLotLink>) => {
        setDraft(prev => {
            const lots = [...prev.parkingLots];
            lots[index] = {...lots[index], ...patch};
            return {...prev, parkingLots: lots};
        });
    };
    const addLink = () => setDraft(prev => ({
        ...prev,
        parkingLots: [...prev.parkingLots, {lotId: ''}],
    }));
    const removeLink = (index: number) => setDraft(prev => ({
        ...prev,
        parkingLots: prev.parkingLots.filter((_, i) => i !== index),
    }));

    return (
        <>
            <div className="admin-form-grid">
                <label>
                    <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                    <input
                        value={draft.nameEn}
                        onChange={e => setDraft(prev => ({...prev, nameEn: e.target.value}))}
                        className="admin-input"
                        placeholder="e.g. Husky Union Building"
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                    <input
                        value={draft.nameCn}
                        onChange={e => setDraft(prev => ({...prev, nameCn: e.target.value}))}
                        className="admin-input"
                        placeholder="例如：学生活动中心"
                    />
                </label>
            </div>

            <div className="admin-field-section">
                <span className="admin-field-label">
                    {isEnglish ? 'Venue Location' : '场地位置'}
                </span>
                <MapPicker
                    value={{lat: draft.lat, lng: draft.lng}}
                    onChange={({lat, lng}) => setDraft(prev => ({...prev, lat, lng}))}
                />
            </div>

            <div className="admin-venue-lots">
                <div className="admin-venue-lots-header">
                    <span className="admin-venue-lots-title">
                        {isEnglish ? 'Linked Parking Lots' : '关联停车场'}
                        {draft.parkingLots.length > 0 && (
                            <span className="admin-venue-lots-count">{draft.parkingLots.length}</span>
                        )}
                    </span>
                    <button
                        type="button"
                        className="admin-venue-lot-add"
                        onClick={addLink}
                        disabled={availableLots.length === 0}
                    >
                        {isEnglish ? '+ Link a lot' : '+ 关联停车场'}
                    </button>
                </div>

                {availableLots.length === 0 ? (
                    <div className="admin-venue-lot-empty">
                        {isEnglish
                            ? 'No parking lots exist yet. Create one in the Parking Lots section first.'
                            : '尚无停车场。请先在"停车场"区块创建。'}
                    </div>
                ) : draft.parkingLots.length === 0 ? (
                    <div className="admin-venue-lot-empty">
                        {isEnglish
                            ? 'No lots linked yet. Click "Link a lot" to add one.'
                            : '尚未关联停车场。点击"关联停车场"添加。'}
                    </div>
                ) : (
                    <div className="admin-venue-lot-list">
                        {draft.parkingLots.map((link, i) => {
                            const lot = availableLots.find(l => l.id === link.lotId);
                            const badge = lot ? lotBadgeChar(lot.type) : '·';
                            const typeLabel = lot ? lotTypeLabel(lot.type, isEnglish) : '';
                            return (
                                <div key={i} className="admin-venue-lot-card">
                                    <div
                                        className="admin-venue-lot-badge"
                                        data-type={lot?.type ?? 'empty'}
                                        title={typeLabel}
                                    >
                                        {badge}
                                    </div>
                                    <div className="admin-venue-lot-body">
                                        <select
                                            value={link.lotId}
                                            onChange={e => updateLink(i, {lotId: e.target.value})}
                                            className="admin-input admin-venue-lot-select"
                                        >
                                            <option value="">{isEnglish ? '— Select a lot —' : '— 请选择 —'}</option>
                                            {availableLots.map(opt => (
                                                <option key={opt.id} value={opt.id}>
                                                    {isEnglish ? opt.name : (opt.nameCn || opt.name)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        className="admin-venue-lot-remove"
                                        onClick={() => removeLink(i)}
                                        title={isEnglish ? 'Remove lot' : '删除停车场'}
                                        aria-label={isEnglish ? 'Remove lot' : '删除停车场'}
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
};
