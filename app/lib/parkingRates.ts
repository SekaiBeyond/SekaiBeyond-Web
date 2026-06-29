import { useMemo } from 'react';
import { createCollectionCache } from './collectionCache';

/**
 * A reusable parking-rate tier (e.g. "$5.00 hourly, $21.00 daily"), shared across lots.
 * Tiers are managed from the admin panel rather than hard-coded so they can track UW's
 * published self-serve rates without a code change. `order` preserves the admin's intended
 * display order (assigned server-side at creation).
 */
export interface ParkingRate {
    id: string;
    labelEn: string;
    labelCn: string;
    order: number;
}

const cache = createCollectionCache<ParkingRate>('parkingRates', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        labelEn: data.labelEn ?? '',
        labelCn: data.labelCn ?? '',
        order: typeof data.order === 'number' ? data.order : 0,
    };
});

/** Localized rate label, falling back to the English label when no translation exists. */
export function rateLabel(rate: ParkingRate, isEnglish: boolean): string {
    return isEnglish ? rate.labelEn : (rate.labelCn || rate.labelEn);
}

export function useParkingRates(): {parkingRates: ParkingRate[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    // Stable, admin-controlled ordering; tie-break on label so the list never jitters.
    const parkingRates = useMemo(
        () => [...items].sort((a, b) => a.order - b.order || a.labelEn.localeCompare(b.labelEn)),
        [items],
    );
    return {parkingRates, loading, refresh};
}
