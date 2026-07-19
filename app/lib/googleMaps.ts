/**
 * Google Maps credentials shared by every map on the site (admin pickers,
 * overview map, QR spots map, public parking guide). 'DEMO_MAP_ID' is Google's
 * documented placeholder that keeps AdvancedMarker working without a styled map.
 */
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';
