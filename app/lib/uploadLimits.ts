import { createValueCache } from './collectionCache';
import { callGetUploadLimits } from './firebase';

/** The server's upload caps, in megabytes. */
export interface UploadLimits {
    imageMb: number;
    videoMb: number;
}

// The server's defaults, until it answers. It enforces its own caps regardless.
const FALLBACK_LIMITS: UploadLimits = {imageMb: 10, videoMb: 20};

const cache = createValueCache<UploadLimits>(
    'upload limits',
    async () => (await callGetUploadLimits()).data,
    FALLBACK_LIMITS,
);

/**
 * Mount in any component that checks files before upload, so the limits are
 * loaded by the time one is picked.
 */
export function useUploadLimits(): UploadLimits {
    return cache.useValue().value;
}
