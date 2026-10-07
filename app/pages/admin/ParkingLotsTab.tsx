import { forwardRef, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteParkingLot, callSaveParkingLot } from '~/lib/firebase';
import { lotTypeShortLabel, type ParkingLot } from '~/lib/parkingLots';
import { type ParkingRate, rateLabel } from '~/lib/parkingRates';
import { UW_CAMPUS_CENTER } from '~/lib/venues';
import { BilingualFormField } from './BilingualFormField';
import { CardEditDeleteActions, CardSaveCancel, CreateSection } from './CrudShell';
import { MapPicker } from './MapPicker';
import { type LocationListHandle, useCardHighlight } from './useCardHighlight';

const LOT_TYPES: ParkingLot['type'][] = ['general', 'disabled', 'garage'];

interface LotDraft {
    name: string;
    nameCn: string;
    type: ParkingLot['type'];
    lat: number;
    lng: number;
    rateId: string;
}

function lotToDraft(lot: ParkingLot): LotDraft {
    return {
        name: lot.name,
        nameCn: lot.nameCn,
        type: lot.type,
        lat: lot.lat,
        lng: lot.lng,
        rateId: lot.rateId,
    };
}

function emptyDraft(): LotDraft {
    return {
        name: '',
        nameCn: '',
        type: 'general',
        lat: UW_CAMPUS_CENTER.lat,
        lng: UW_CAMPUS_CENTER.lng,
        rateId: '',
    };
}

interface ParkingLotsTabProps {
    parkingLots: ParkingLot[];
    parkingRates: ParkingRate[];
    refreshParkingLots: () => Promise<void>;
    refreshVenues: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ParkingLotsTab = forwardRef<LocationListHandle, ParkingLotsTabProps>((
    {
        parkingLots,
        parkingRates,
        refreshParkingLots,
        refreshVenues,
        showToast,
        readOnly = false,
    }, ref) => {
    const {isEnglish} = useLanguage();
    const {highlightedId, registerCard, highlight} = useCardHighlight();
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
        rateId: draft.rateId,
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

    useImperativeHandle(ref, () => ({
        highlight,
        openEdit: (id: string) => {
            const lot = parkingLots.find(l => l.id === id);
            if (!lot) return;
            if (!readOnly) openEdit(lot);
            highlight(id);
        },
    }));

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
            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'Parking lots are shared across venues. Link them to a venue from the Venues section.'
                    : '停车场为多个场地共享。请在"场地"区块将其关联到场地。'}
            </p>

            {!readOnly && (
                <CreateSection
                    show={showCreate}
                    setShow={setShowCreate}
                    newLabel={isEnglish ? '+ New Parking Lot' : '+ 新建停车场'}
                    title={isEnglish ? 'Create New Parking Lot' : '创建新停车场'}
                    ctaLabel={isEnglish ? 'Create Lot' : '创建停车场'}
                    ctaBusyLabel={isEnglish ? 'Creating...' : '创建中...'}
                    busy={saving}
                    onCreate={createLot}
                    onCancel={() => setCreateDraft(emptyDraft())}
                >
                    <LotForm draft={createDraft} setDraft={setCreateDraft} parkingRates={parkingRates}
                             isEnglish={isEnglish}/>
                </CreateSection>
            )}

            {parkingLots.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No parking lots yet.' : '暂无停车场。'}</p>
            )}

            <div className="admin-event-grid">
                {parkingLots.map(lot => {
                    const typeLabel = lotTypeShortLabel(lot.type, isEnglish);
                    const rate = lot.rateId ? parkingRates.find(r => r.id === lot.rateId) : undefined;
                    return (
                        <div
                            key={lot.id}
                            ref={registerCard(lot.id)}
                            className={`admin-event-card${editingId === lot.id ? ' admin-event-card-editing' : ''}${highlightedId === lot.id ? ' admin-card-highlight' : ''}`}
                        >
                            <div className="admin-event-card-info">
                                {editingId === lot.id ? (
                                    <>
                                        <LotForm draft={editDraft} setDraft={setEditDraft} parkingRates={parkingRates}
                                                 isEnglish={isEnglish}/>
                                        <CardSaveCancel
                                            saving={saving}
                                            onSave={saveEdit}
                                            onCancel={() => setEditingId(null)}
                                            topMargin
                                        />
                                    </>
                                ) : (
                                    <>
                                        <span className="admin-event-card-title">{lot.name}</span>
                                        {lot.nameCn && (
                                            <span className="admin-event-card-date">{lot.nameCn}</span>
                                        )}
                                        <span className="admin-helper-text admin-card-meta">
                                            {typeLabel}{rate ? ` · ${rateLabel(rate, isEnglish)}` : ''}
                                        </span>
                                        {!readOnly && (
                                            <CardEditDeleteActions
                                                onEdit={() => openEdit(lot)}
                                                onDelete={() => deleteLot(lot)}
                                                deleting={deletingId === lot.id}
                                            />
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
});
ParkingLotsTab.displayName = 'ParkingLotsTab';

interface LotFormProps {
    draft: LotDraft;
    setDraft: (updater: (prev: LotDraft) => LotDraft) => void;
    parkingRates: ParkingRate[];
    isEnglish: boolean;
}

const LotForm = ({draft, setDraft, parkingRates, isEnglish}: LotFormProps) => (
    <>
        <div className="admin-form-grid">
            <BilingualFormField
                label="Name" labelCn="名称"
                value={draft.name} valueCn={draft.nameCn}
                onChange={v => setDraft(prev => ({...prev, name: v}))}
                onChangeCn={v => setDraft(prev => ({...prev, nameCn: v}))}
                placeholder="e.g. N24 General Parking"
                placeholderCn="例如：N24 普通停车场"
            />
            <label>
                <span>{isEnglish ? 'Type' : '类型'}</span>
                <select
                    value={draft.type}
                    onChange={e => setDraft(prev => ({...prev, type: e.target.value as ParkingLot['type']}))}
                    className="admin-input"
                >
                    {LOT_TYPES.map(t => (
                        <option key={t} value={t}>
                            {lotTypeShortLabel(t, isEnglish)}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                <span>{isEnglish ? 'Rate' : '费率'}</span>
                <select
                    value={draft.rateId}
                    onChange={e => setDraft(prev => ({...prev, rateId: e.target.value}))}
                    className="admin-input"
                >
                    <option value="">{isEnglish ? '— No rate —' : '— 无费率 —'}</option>
                    {parkingRates.map(rate => (
                        <option key={rate.id} value={rate.id}>
                            {rateLabel(rate, isEnglish)}
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
    </>
);
