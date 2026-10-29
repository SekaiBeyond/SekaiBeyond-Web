import { doc, getDoc } from 'firebase/firestore';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { createValueCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

interface Policy {
    contentEn: string;
    contentCn: string;
    updatedAt: Date | null;
}

const EMPTY_POLICY: Policy = {contentEn: '', contentCn: '', updatedAt: null};

const cache = createValueCache<Policy>('policy', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'policy', 'main'));
    const data = snap.data();
    return {
        contentEn: data?.contentEn ?? '',
        contentCn: data?.contentCn ?? '',
        updatedAt: toDate(data?.updatedAt),
    };
}, EMPTY_POLICY);

export function usePolicy(): {policy: Policy; loading: boolean; failed: boolean; refresh: () => Promise<void>} {
    const {value: policy, loading, error, refresh} = cache.useValue();
    return {policy, loading, failed: error !== null, refresh};
}

// Admin-written, but sanitized since it goes into the page as raw HTML. `align`
// is how marked emits a column's alignment.
const POLICY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'del', 'img'],
    allowedAttributes: {
        a: ['href', 'title'],
        img: ['src', 'alt', 'title'],
        th: ['align'],
        td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
};

// `breaks` keeps a single newline as a line break, so plain-text policy reads
// as typed.
export const renderPolicyMarkdown = (content: string): string =>
    sanitizeHtml(marked.parse(content, {async: false, gfm: true, breaks: true}), POLICY_SANITIZE_OPTIONS);
