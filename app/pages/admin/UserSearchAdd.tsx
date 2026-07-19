import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';
import { searchUsers, type ShowToast } from './utils';
import { UserRow } from './UserRow';

interface UserSearchAddProps {
    /** Users hidden from the results (already on the roster, or otherwise ineligible). */
    excludeUids: Set<string>;
    /** Uid of the user whose add is in flight, to disable just that row's button. */
    busyUid: string | null;
    onAdd: (user: UserRecord) => void;
    addLabel: string;
    addingLabel: string;
    /** Shown when a completed search has no addable results. */
    noMatchMessage: string;
    showToast: ShowToast;
}

/**
 * Search box + candidate rows for adding a user to a roster (event staff,
 * attendees). Owns the search flow; the caller owns what "add" means and keeps
 * `excludeUids` current so added users drop out of the results.
 */
export function UserSearchAdd({
                                  excludeUids,
                                  busyUid,
                                  onAdd,
                                  addLabel,
                                  addingLabel,
                                  noMatchMessage,
                                  showToast,
                              }: UserSearchAddProps) {
    const {isEnglish} = useLanguage();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const runSearch = async () => {
        const q = searchQuery.trim();
        if (!q) {
            setSearchResults([]);
            setHasSearched(false);
            return;
        }
        setSearching(true);
        try {
            setSearchResults(await searchUsers(q));
        } catch {
            showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error');
        } finally {
            setSearching(false);
            setHasSearched(true);
        }
    };

    const candidates = searchResults.filter(u => !excludeUids.has(u.uid));

    return (
        <div className="admin-event-staff-add"
             style={{marginTop: 16, flexDirection: 'column', alignItems: 'stretch', gap: 8}}>
            <div className="admin-search">
                <input
                    type="text"
                    className="admin-input"
                    placeholder={isEnglish ? 'Search user by email or name...' : '输入邮箱或姓名搜索用户...'}
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setHasSearched(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                <button
                    className="admin-btn admin-btn--cta"
                    onClick={runSearch}
                    disabled={searching || !searchQuery.trim()}
                >
                    {searching
                        ? (isEnglish ? 'Searching...' : '搜索中...')
                        : (isEnglish ? 'Search' : '搜索')}
                </button>
            </div>

            {hasSearched && !searching && candidates.length === 0 && (
                <p className="admin-no-results">{noMatchMessage}</p>
            )}

            {candidates.map(u => (
                <UserRow key={u.uid} user={u}>
                    <button
                        className="admin-toggle-btn admin-toggle-grant"
                        onClick={() => onAdd(u)}
                        disabled={busyUid === u.uid}
                    >
                        {busyUid === u.uid ? addingLabel : addLabel}
                    </button>
                </UserRow>
            ))}
        </div>
    );
}
