import { forwardRef, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteVenue,
    callLookUpUwBuilding,
    callSaveVenue,
    errorMessage,
    type UwBuildingLookup,
} from '~/lib/firebase';
import {
    isGarage,
    useUwParking,
    type UwLot,
    uwLotGlyph,
    uwLotTypeLabel,
    type UwParkingData,
    walkMinutes
} from '~/lib/uwParking';
import type { SuggestedLot, Venue } from '~/lib/venues';
import { haversineMiles, UW_CAMPUS_CENTER } from '~/lib/venues';
import { BilingualFormField } from './BilingualFormField';
import { CardEditDeleteActions, CardSaveCancel, CreateSection } from './CrudShell';
import { MapPicker } from './MapPicker';
import { type LocationListHandle, useCardHighlight } from './useCardHighlight';
import { refreshAfterSave, type ShowToast } from './utils';

/** The server's cap on suggested lots per venue. */
const MAX_SUGGESTED_LOTS = 10;
/** How many lots the editor fills in from a building lookup when the list is empty. */
const PREFILL_COUNT = 3;
const METERS_PER_MILE = 1609.34;

interface VenueDraft {
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    buildingCode: string;
    suggestedLots: SuggestedLot[];
}

function venueToDraft(v: Venue): VenueDraft {
    return {
        nameEn: v.nameEn,
        nameCn: v.nameCn,
        lat: v.lat,
        lng: v.lng,
        buildingCode: v.buildingCode,
        suggestedLots: v.suggestedLots.map(s => ({...s})),
    };
}

function emptyDraft(): VenueDraft {
    return {
        nameEn: '',
        nameCn: '',
        lat: UW_CAMPUS_CENTER.lat,
        lng: UW_CAMPUS_CENTER.lng,
        buildingCode: '',
        suggestedLots: [],
    };
}

function draftToPayload(draft: VenueDraft) {
    return {
        nameEn: draft.nameEn.trim(),
        nameCn: draft.nameCn.trim(),
        lat: draft.lat,
        lng: draft.lng,
        buildingCode: draft.buildingCode.trim().toUpperCase(),
        suggestedLots: draft.suggestedLots.map(s => ({code: s.code, noteEn: s.noteEn.trim(), noteCn: s.noteCn.trim()})),
    };
}

const metersBetween = (a: {lat: number; lng: number}, b: {lat: number; lng: number}) =>
    haversineMiles(a.lat, a.lng, b.lat, b.lng) * METERS_PER_MILE;

interface VenuesTabProps {
    venues: Venue[];
    refreshVenues: () => Promise<void>;
    showToast: ShowToast;
    readOnly?: boolean;
}

export const VenuesTab = forwardRef<LocationListHandle, VenuesTabProps>((
    {venues, refreshVenues, showToast, readOnly = false}, ref) => {
    const {isEnglish} = useLanguage();
    const {parking, refresh: refreshParking} = useUwParking();
    const {highlightedId, registerCard, highlight} = useCardHighlight();
    const [showCreate, setShowCreate] = useState(false);
    const [createDraft, setCreateDraft] = useState<VenueDraft>(emptyDraft());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<VenueDraft>(emptyDraft());
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const validateDraft = (draft: VenueDraft): string | null => {
        if (!draft.nameEn.trim()) return isEnglish ? 'English name is required.' : '英文名称是必填项。';
        const code = draft.buildingCode.trim();
        if (code && !/^[A-Za-z0-9]{2,8}$/.test(code)) {
            return isEnglish ? 'A UW building code is 2–8 letters or digits, like HUB.' : 'UW 建筑代码为 2–8 位字母或数字，例如 HUB。';
        }
        return null;
    };

    // Saving a new or moved venue re-measures its walking times on the server.
    const afterSave = async () => {
        await refreshAfterSave(refreshVenues, showToast, isEnglish);
        await refreshParking().catch(() => undefined);
    };

    const createVenue = async () => {
        const err = validateDraft(createDraft);
        if (err) {
            showToast(err, 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveVenue(draftToPayload(createDraft));
            await afterSave();
            setCreateDraft(emptyDraft());
            setShowCreate(false);
            showToast(isEnglish ? 'Venue created.' : '场地已创建。', 'success');
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to create venue.' : '创建场地失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (venue: Venue) => {
        setEditingId(venue.id);
        setEditDraft(venueToDraft(venue));
    };

    useImperativeHandle(ref, () => ({
        highlight,
        openEdit: (id: string) => {
            const venue = venues.find(v => v.id === id);
            if (!venue) return;
            if (!readOnly) openEdit(venue);
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
            await callSaveVenue({venueId: editingId, ...draftToPayload(editDraft)});
            await afterSave();
            setEditingId(null);
            showToast(isEnglish ? 'Venue updated.' : '场地已更新。', 'success');
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to save venue.' : '保存场地失败。'), 'error');
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
            await afterSave();
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
                    ? 'Venues power the parking guide. Give each venue its UW building code to place it, then pick the UW lots to suggest; the guide lists them nearest first. Rates, hours and walking times come from UW data automatically. Pick a venue for an event from the Venue selector in the event editor.'
                    : '场地数据用于停车指南。为每个场地填写 UW 建筑代码以确定位置，然后选择要推荐的 UW 停车场，停车指南将按距离由近到远列出。费率、收费时间和步行时间会自动从 UW 数据获取。在活动编辑器的“场地”选择器中为活动选择场地。'}
            </p>

            {!readOnly && (
                <CreateSection
                    show={showCreate}
                    setShow={setShowCreate}
                    newLabel={isEnglish ? '+ New Venue' : '+ 新建场地'}
                    title={isEnglish ? 'Create New Venue' : '创建新场地'}
                    ctaLabel={isEnglish ? 'Create Venue' : '创建场地'}
                    ctaBusyLabel={isEnglish ? 'Creating...' : '创建中...'}
                    busy={saving}
                    onCreate={createVenue}
                    onCancel={() => setCreateDraft(emptyDraft())}
                >
                    <VenueForm
                        draft={createDraft}
                        setDraft={setCreateDraft}
                        venueId={null}
                        parking={parking}
                        isEnglish={isEnglish}
                    />
                </CreateSection>
            )}

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
                                        venueId={venue.id}
                                        parking={parking}
                                        isEnglish={isEnglish}
                                    />
                                    <CardSaveCancel
                                        saving={saving}
                                        onSave={saveEdit}
                                        onCancel={() => setEditingId(null)}
                                        topMargin
                                    />
                                </>
                            ) : (
                                <>
                                    <span className="admin-event-card-title">
                                        {venue.nameEn}
                                        {venue.buildingCode &&
                                            <span className="admin-uw-code-chip">{venue.buildingCode}</span>}
                                    </span>
                                    {venue.nameCn && (
                                        <span className="admin-event-card-date">{venue.nameCn}</span>
                                    )}
                                    <span className="admin-helper-text admin-card-meta">
                                        {venue.suggestedLots.length > 0
                                            ? `${isEnglish ? 'Suggested lots' : '推荐停车场'}: ${venue.suggestedLots.map(s => s.code).join(' · ')}`
                                            : (isEnglish ? 'No suggested lots yet' : '尚未选择推荐停车场')}
                                    </span>
                                    {!readOnly && (
                                        <CardEditDeleteActions
                                            onEdit={() => openEdit(venue)}
                                            onDelete={() => deleteVenue(venue)}
                                            deleting={deletingId === venue.id}
                                        />
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
    /** The venue being edited, or null while creating one. */
    venueId: string | null;
    parking: UwParkingData;
    isEnglish: boolean;
}

const VenueForm = ({draft, setDraft, venueId, parking, isEnglish}: VenueFormProps) => {
    const [lookingUp, setLookingUp] = useState(false);
    const [lookup, setLookup] = useState<UwBuildingLookup | null>(null);
    const [lookupError, setLookupError] = useState<string | null>(null);

    const lotByCode = new Map(parking.lots.map(l => [l.code, l]));
    const chosen = new Set(draft.suggestedLots.map(s => s.code));
    const full = draft.suggestedLots.length >= MAX_SUGGESTED_LOTS;
    const here = {lat: draft.lat, lng: draft.lng};
    const sameSpot = (p: {lat: number; lng: number}) => metersBetween(p, here) < 1;

    // Walking time from the venue as the form has it: from a lookup of this spot, from the
    // last sync if it hasn't moved, else a straight-line estimate.
    const synced = venueId ? parking.walking[venueId] : undefined;
    const walkLabel = (lot: UwLot): string => {
        const fromLookup = lookup && sameSpot(lookup.building) ? lookup.nearestLots.find(n => n.code === lot.code) : undefined;
        const fromSync = synced && sameSpot(synced) ? synced.lots[lot.code] : undefined;
        const walk = fromLookup ?? fromSync;
        if (walk) return isEnglish ? `${walkMinutes(walk.seconds)} min walk` : `步行 ${walkMinutes(walk.seconds)} 分钟`;
        const m = Math.round(metersBetween(lot, here) / 10) * 10;
        return isEnglish ? `~${m} m away` : `约 ${m} 米`;
    };

    const addLots = (codes: string[]) => setDraft(prev => {
        const have = new Set(prev.suggestedLots.map(s => s.code));
        const added = codes.filter(c => !have.has(c)).map(code => ({code, noteEn: '', noteCn: ''}));
        return {...prev, suggestedLots: [...prev.suggestedLots, ...added].slice(0, MAX_SUGGESTED_LOTS)};
    });
    const updateLot = (index: number, patch: Partial<SuggestedLot>) => setDraft(prev => {
        const lots = [...prev.suggestedLots];
        lots[index] = {...lots[index], ...patch};
        return {...prev, suggestedLots: lots};
    });
    const removeLot = (index: number) => setDraft(prev => ({
        ...prev,
        suggestedLots: prev.suggestedLots.filter((_, i) => i !== index),
    }));

    const lookUp = async () => {
        const code = draft.buildingCode.trim().toUpperCase();
        if (!code) return;
        setLookingUp(true);
        setLookupError(null);
        try {
            const {data} = await callLookUpUwBuilding({code});
            setLookup(data);
            const {building} = data;
            // An empty list is filled from UW's note first, then the nearest lots on foot.
            const prefill = [...data.recommendedLots, ...data.nearestLots.map(n => n.code)]
                .filter((c, i, all) => all.indexOf(c) === i)
                .slice(0, PREFILL_COUNT);
            setDraft(prev => ({
                ...prev,
                buildingCode: building.code,
                lat: building.lat,
                lng: building.lng,
                nameEn: prev.nameEn.trim() ? prev.nameEn : building.name,
                suggestedLots: prev.suggestedLots.length > 0
                    ? prev.suggestedLots
                    : prefill.map(c => ({code: c, noteEn: '', noteCn: ''})),
            }));
        } catch (e) {
            setLookup(null);
            setLookupError(errorMessage(e, isEnglish ? 'Lookup failed.' : '查询失败。'));
        } finally {
            setLookingUp(false);
        }
    };

    // Suggestions, each skipping lots already on the list.
    const fresh = (codes: string[]) => codes.filter(c => !chosen.has(c) && lotByCode.has(c));
    const uwPicks = lookup ? fresh(lookup.recommendedLots) : [];
    const lotsByDistance = parking.lots
        .map(lot => ({lot, meters: metersBetween(lot, here)}))
        .sort((a, b) => a.meters - b.meters)
        .map(({lot}) => lot);
    const nearest = fresh(
        lookup && sameSpot(lookup.building)
            ? lookup.nearestLots.map(n => n.code)
            : lotsByDistance.map(l => l.code),
    ).slice(0, 6);

    const chipRow = (label: string, codes: string[]) => codes.length > 0 && (
        <div className="admin-venue-suggest">
            <span className="admin-venue-suggest-label">{label}</span>
            {codes.map(code => (
                <button
                    key={code}
                    type="button"
                    className="admin-venue-suggest-chip"
                    onClick={() => addLots([code])}
                    disabled={full}
                >
                    + {code}
                    <span>{walkLabel(lotByCode.get(code)!)}</span>
                </button>
            ))}
        </div>
    );

    return (
        <>
            <div className="admin-field-section">
                <span className="admin-field-label">{isEnglish ? 'UW Building' : 'UW 建筑'}</span>
                <div className="admin-uw-building-row">
                    <input
                        value={draft.buildingCode}
                        onChange={e => setDraft(prev => ({...prev, buildingCode: e.target.value.toUpperCase()}))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                lookUp();
                            }
                        }}
                        className="admin-input admin-uw-building-input"
                        placeholder={isEnglish ? 'e.g. HUB' : '例如：HUB'}
                        maxLength={8}
                        aria-label={isEnglish ? 'UW building code' : 'UW 建筑代码'}
                    />
                    <button
                        type="button"
                        className="admin-venue-lot-add"
                        onClick={lookUp}
                        disabled={lookingUp || !draft.buildingCode.trim()}
                    >
                        {lookingUp ? (isEnglish ? 'Looking up…' : '查询中…') : (isEnglish ? 'Look up' : '查询')}
                    </button>
                </div>
                <p className="admin-helper-text admin-mt-8">
                    {isEnglish
                        ? 'The building’s UW code, as in room numbers like HUB 214 or KNE 120. Look up sets the location and fills in suggested lots.'
                        : '建筑的 UW 代码，即教室编号中的字母，例如 HUB 214、KNE 120。查询后会自动设置位置并填入推荐停车场。'}
                </p>
                {lookupError && <div className="admin-uw-note admin-uw-note--error">{lookupError}</div>}
                {lookup && (
                    <div className="admin-uw-note">
                        <strong>{lookup.building.name}</strong>
                        {lookup.building.address && <> · {lookup.building.address}</>}
                        <div>
                            {lookup.building.parkingTip
                                ? (isEnglish ? `UW’s parking note: “${lookup.building.parkingTip}”` : `UW 停车提示：“${lookup.building.parkingTip}”`)
                                : (isEnglish ? 'UW has no parking note for this building.' : 'UW 未提供此建筑的停车提示。')}
                        </div>
                    </div>
                )}
            </div>

            <div className="admin-form-grid">
                <BilingualFormField
                    label="Name" labelCn="名称"
                    value={draft.nameEn} valueCn={draft.nameCn}
                    onChange={v => setDraft(prev => ({...prev, nameEn: v}))}
                    onChangeCn={v => setDraft(prev => ({...prev, nameCn: v}))}
                    placeholder="e.g. Husky Union Building"
                    placeholderCn="例如：学生活动中心"
                />
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
                        {isEnglish ? 'Suggested Parking Lots' : '推荐停车场'}
                        {draft.suggestedLots.length > 0 && (
                            <span className="admin-venue-lots-count">{draft.suggestedLots.length}</span>
                        )}
                    </span>
                    <select
                        className="admin-input admin-venue-lot-picker"
                        value=""
                        onChange={e => e.target.value && addLots([e.target.value])}
                        disabled={full || parking.lots.length === 0}
                        aria-label={isEnglish ? 'Add a lot' : '添加停车场'}
                    >
                        <option value="">{isEnglish ? '+ Add a lot…' : '+ 添加停车场…'}</option>
                        {lotsByDistance.filter(l => !chosen.has(l.code)).map(l => (
                            <option key={l.code} value={l.code}>
                                {l.code}{l.name !== l.code ? ` · ${l.name}` : ''} · {walkLabel(l)}
                            </option>
                        ))}
                    </select>
                </div>

                {parking.lots.length === 0 ? (
                    <div className="admin-venue-lot-empty">
                        {isEnglish
                            ? 'UW parking data hasn’t synced yet. Use Sync now in the UW Parking Data section first.'
                            : 'UW 停车数据尚未同步。请先在“UW 停车数据”区块点击“立即同步”。'}
                    </div>
                ) : (
                    <>
                        {chipRow(isEnglish ? 'UW recommends' : 'UW 推荐', uwPicks)}
                        {chipRow(isEnglish ? 'Nearest' : '最近', nearest)}

                        {draft.suggestedLots.length === 0 ? (
                            <div className="admin-venue-lot-empty">
                                {isEnglish
                                    ? 'No suggested lots yet. Look up the building, tap a suggestion, or add a lot.'
                                    : '尚未选择推荐停车场。可查询建筑、点击上方建议或手动添加。'}
                            </div>
                        ) : (
                            <div className="admin-venue-lot-list">
                                {draft.suggestedLots.map((s, i) => {
                                    const lot = lotByCode.get(s.code);
                                    return (
                                        <div key={s.code}
                                             className="admin-venue-lot-card admin-venue-lot-card--suggested">
                                            <div
                                                className="admin-venue-lot-badge"
                                                data-type={lot && isGarage(lot) ? 'garage' : 'general'}
                                            >
                                                {lot ? uwLotGlyph(lot.type) : '?'}
                                            </div>
                                            <div className="admin-venue-lot-main">
                                                <div className="admin-venue-lot-head">
                                                    <span className="admin-venue-lot-code">{s.code}</span>
                                                    {lot ? (
                                                        <>
                                                            <span className="admin-venue-lot-name">
                                                                {lot.name !== lot.code ? `${lot.name} · ` : ''}{uwLotTypeLabel(lot.type, isEnglish)}
                                                            </span>
                                                            <span
                                                                className="admin-venue-lot-walk">{walkLabel(lot)}</span>
                                                        </>
                                                    ) : (
                                                        <span className="admin-venue-lot-missing">
                                                            {isEnglish ? 'No longer a UW visitor lot; the guide skips it.' : '已不再是 UW 访客停车场，停车指南将跳过。'}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="admin-venue-lot-notes">
                                                    <input
                                                        value={s.noteEn}
                                                        onChange={e => updateLot(i, {noteEn: e.target.value})}
                                                        className="admin-input"
                                                        maxLength={300}
                                                        placeholder={isEnglish ? 'Note (English), optional' : '提示（英文），可选'}
                                                    />
                                                    <input
                                                        value={s.noteCn}
                                                        onChange={e => updateLot(i, {noteCn: e.target.value})}
                                                        className="admin-input"
                                                        maxLength={300}
                                                        placeholder={isEnglish ? 'Note (Chinese), optional' : '提示（中文），可选'}
                                                    />
                                                </div>
                                            </div>
                                            <div className="admin-venue-lot-actions">
                                                <button
                                                    type="button"
                                                    className="admin-venue-lot-remove"
                                                    onClick={() => removeLot(i)}
                                                    title={isEnglish ? 'Remove lot' : '删除停车场'}
                                                    aria-label={isEnglish ? 'Remove lot' : '删除停车场'}
                                                >×
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
};
