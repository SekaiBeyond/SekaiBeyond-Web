import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserGroup } from '~/components/AuthProvider';
import type { UserRecord } from './types';
import { searchUsers } from './utils';

export function useUserSearch(onFailed?: () => void) {
    const [query, setQueryState] = useState('');
    const [results, setResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [failed, setFailed] = useState(false);

    const clear = () => {
        setResults([]);
        setHasSearched(false);
        setFailed(false);
    };

    const setQuery = (next: string) => {
        setQueryState(next);
        setHasSearched(false);
        setFailed(false);
    };

    const run = async (group?: UserGroup | '', membersOnly?: boolean) => {
        const q = query.trim();
        if (!q) {
            clear();
            return;
        }
        setSearching(true);
        setFailed(false);
        try {
            setResults(await searchUsers(q, group, membersOnly));
        } catch {
            setResults([]);
            setFailed(true);
            onFailed?.();
        } finally {
            setSearching(false);
            setHasSearched(true);
        }
    };

    return {query, setQuery, results, setResults, searching, hasSearched, failed, run, clear};
}

export function UserSearchInput({search, onSearch, placeholder}: {
    search: ReturnType<typeof useUserSearch>;
    onSearch: () => void;
    placeholder: string;
}) {
    const {isEnglish} = useLanguage();
    return (
        <>
            <input
                type="text"
                className="admin-input"
                placeholder={placeholder}
                value={search.query}
                onChange={e => search.setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSearch()}
            />
            <button
                className="admin-btn admin-btn--cta"
                onClick={onSearch}
                disabled={search.searching || !search.query.trim()}
            >
                {search.searching
                    ? (isEnglish ? 'Searching...' : '搜索中...')
                    : (isEnglish ? 'Search' : '搜索')}
            </button>
        </>
    );
}
