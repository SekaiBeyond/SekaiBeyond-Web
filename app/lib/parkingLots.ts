import { createCollectionCache } from './collectionCache';

export interface ParkingLot {
    id: string;
    name: string;
    nameCn: string;
    type: 'general' | 'disabled' | 'garage';
    lat: number;
    lng: number;
    /** Id of the linked parking-rate tier, or '' when no rate is assigned. */
    rateId: string;
}

/** Localized full "<type> Parking" label (e.g. "Disabled Parking" / "无障碍停车"). */
export function lotTypeLabel(type: ParkingLot['type'], isEnglish: boolean): string {
    if (isEnglish) {
        return type === 'disabled' ? 'Disabled Parking'
            : type === 'garage' ? 'Parking Garage' : 'General Parking';
    }
    return type === 'disabled' ? '无障碍停车'
        : type === 'garage' ? '停车库' : '普通停车';
}

/** Short type label for compact admin lists (e.g. "Disabled" / "无障碍"). */
export function lotTypeShortLabel(type: ParkingLot['type'], isEnglish: boolean): string {
    if (isEnglish) {
        return type === 'disabled' ? 'Disabled'
            : type === 'garage' ? 'Garage' : 'General';
    }
    return type === 'disabled' ? '无障碍'
        : type === 'garage' ? '停车库' : '普通';
}

/** Single-character badge glyph for a lot type (♿ / G / P). */
export function lotBadgeChar(type: ParkingLot['type']): string {
    return type === 'disabled' ? '♿' : type === 'garage' ? 'G' : 'P';
}

const cache = createCollectionCache<ParkingLot>('parkingLots', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        name: data.name ?? '',
        nameCn: data.nameCn ?? '',
        type: (data.type === 'disabled' || data.type === 'garage') ? data.type : 'general',
        lat: typeof data.lat === 'number' ? data.lat : 0,
        lng: typeof data.lng === 'number' ? data.lng : 0,
        rateId: data.rateId ?? '',
    };
});

export function useParkingLots(): {parkingLots: ParkingLot[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {parkingLots: items, loading, refresh};
}
