import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';
import { UserSearchInput, useUserSearch } from './useUserSearch';
import { UserRow } from './UserRow';

interface UserSearchAddProps {
    excludeUids: Set<string>;
    busyUid: string | null;
    onAdd: (user: UserRecord) => void;
    addLabel: string;
    addingLabel: string;
    noMatchMessage: string;
    showToast: ShowToast;
    inField?: boolean;
}

export function UserSearchAdd({
                                  excludeUids,
                                  busyUid,
                                  onAdd,
                                  addLabel,
                                  addingLabel,
                                  noMatchMessage,
                                  showToast,
                                  inField = false,
                              }: UserSearchAddProps) {
    const {isEnglish} = useLanguage();
    const search = useUserSearch(() =>
        showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error'));

    const candidates = search.results.filter(u => !excludeUids.has(u.uid));

    return (
        <div style={{marginTop: inField ? 0 : 16}}>
            <div className="admin-search" style={inField ? {marginBottom: 0} : undefined}>
                <UserSearchInput
                    search={search}
                    onSearch={() => void search.run()}
                    placeholder={isEnglish ? 'Search user by email or name...' : '输入邮箱或姓名搜索用户...'}
                />
            </div>

            {search.hasSearched && !search.searching && candidates.length === 0 && (
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
