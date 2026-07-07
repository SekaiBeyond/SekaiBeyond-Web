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
    /** Marker color for lots on this tier (hex like '#4b2e83'), or '' for the preset fallback. */
    color: string;
    order: number;
}

/**
 * Swatch presets for rate-tier colors, modeled on UW's parking-map legend (one color per
 * price tier). Rates saved before colors existed fall back to these deterministically by
 * display position, so the map is color-coded even before an admin pins anything.
 */
export const RATE_COLOR_PRESETS = [
    '#f2a33c', // orange
    '#4b2e83', // dark purple
    '#8e44ad', // violet
    '#d34fb2', // magenta
    '#41b8f5', // light blue
    '#2f6fed', // blue
    '#1f8a4c', // green
];

/** Marker color for lots with no rate tier assigned (or a dangling rateId). */
export const NO_RATE_COLOR = '#8b93a1';

/** Effective marker color per rate id: the admin-picked color, or a preset by position. */
export function rateColorById(sortedRates: ParkingRate[]): Record<string, string> {
    const lookup: Record<string, string> = {};
    sortedRates.forEach((rate, i) => {
        lookup[rate.id] = rate.color || RATE_COLOR_PRESETS[i % RATE_COLOR_PRESETS.length];
    });
    return lookup;
}

const cache = createCollectionCache<ParkingRate>('parkingRates', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        labelEn: data.labelEn ?? '',
        labelCn: data.labelCn ?? '',
        color: typeof data.color === 'string' ? data.color : '',
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
