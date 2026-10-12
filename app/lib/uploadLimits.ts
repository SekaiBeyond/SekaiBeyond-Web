import { createValueCache } from './collectionCache';
import { callGetUploadLimits } from './firebase';

/** The server's upload caps, in megabytes. */
export interface UploadLimits {
    imageMb: number;
    videoMb: number;
}

// The server's own defaults, standing in until it answers (or if it can't).
// The server enforces its real caps regardless; these only drive the early
// check and the "up to N MB" hints.
const FALLBACK_LIMITS: UploadLimits = {imageMb: 10, videoMb: 20};

const cache = createValueCache<UploadLimits>(
    'upload limits',
    async () => (await callGetUploadLimits()).data,
    FALLBACK_LIMITS,
);

/**
 * Mount this in any component that checks a file before uploading it, so the
 * limits have loaded by the time someone picks one.
 */
export function useUploadLimits(): UploadLimits {
    return cache.useValue().value;
}
