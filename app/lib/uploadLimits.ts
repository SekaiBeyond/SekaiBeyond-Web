import { createValueCache } from './collectionCache';
import { callGetUploadLimits } from './firebase';

export interface UploadLimits {
    imageMb: number;
    videoMb: number;
}

const FALLBACK_LIMITS: UploadLimits = {imageMb: 10, videoMb: 20};

const cache = createValueCache<UploadLimits>(
    'upload limits',
    async () => (await callGetUploadLimits()).data,
    FALLBACK_LIMITS,
);

export function useUploadLimits(): UploadLimits {
    return cache.useValue().value;
}
