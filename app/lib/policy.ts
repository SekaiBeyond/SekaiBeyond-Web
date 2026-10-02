import { doc, getDoc } from 'firebase/firestore';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';

export interface Policy {
    contentEn: string;
    contentCn: string;
    updatedAt?: Date;
    updatedByName?: string;
}

const EMPTY_POLICY: Policy = {contentEn: '', contentCn: ''};

const cache = createValueCache<Policy>('policy', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'policy', 'main'));
    const data = snap.data();
    return {
        contentEn: data?.contentEn ?? '',
        contentCn: data?.contentCn ?? '',
        updatedAt: data?.updatedAt?.toDate?.(),
        updatedByName: data?.updatedByName,
    };
}, EMPTY_POLICY);

export function usePolicy(): {policy: Policy; loading: boolean; refresh: () => Promise<void>} {
    const {value: policy, loading, refresh} = cache.useValue();
    return {policy, loading, refresh};
}

// What policy Markdown may render to. Admin-written, but sanitized anyway since
// it goes into the page as raw HTML. `align` is how marked emits a table
// column's alignment.
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

// `breaks` keeps a single newline as a line break, so policy text written
// before it was Markdown still reads the way it was typed.
export const renderPolicyMarkdown = (content: string): string =>
    sanitizeHtml(marked.parse(content, {async: false, gfm: true, breaks: true}), POLICY_SANITIZE_OPTIONS);
