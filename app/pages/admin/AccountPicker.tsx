import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';
import { UserAvatar, UserRow } from './UserRow';
import { UserSearchInput, useUserSearch } from './useUserSearch';

interface AccountPickerProps {
    selected: Pick<UserRecord, 'displayName' | 'email' | 'photoURL'> | null;
    onSelect: (user: UserRecord | null) => void;
    manualName?: string;
    onManualNameChange?: (name: string) => void;
    manualLink?: string;
    onManualLinkChange?: (link: string) => void;
    label?: string;
}

export const AccountPicker = ({
                                  selected,
                                  onSelect,
                                  manualName,
                                  onManualNameChange,
                                  manualLink,
                                  onManualLinkChange,
                                  label,
                              }: AccountPickerProps) => {
    const {isEnglish} = useLanguage();
    const search = useUserSearch();

    return (
        <div className="admin-creator-picker">
            {label && (
                <span className="admin-creator-picker-label">
                    {label}
                </span>
            )}
            {selected ? (
                <div className="admin-creator-selected">
                    <UserAvatar photoURL={selected.photoURL} displayName={selected.displayName}/>
                    <div>
                        <div className="admin-user-name">{selected.displayName}</div>
                        <div className="admin-user-email">{selected.email}</div>
                    </div>
                    <button className="admin-btn admin-btn--link" onClick={() => onSelect(null)}>
                        {isEnglish ? 'Clear' : '清除'}
                    </button>
                </div>
            ) : (
                <>
                    <div className="admin-creator-search-row">
                        <UserSearchInput
                            search={search}
                            onSearch={() => void search.run()}
                            placeholder={isEnglish ? 'Search user by name or email' : '通过姓名或邮箱搜索用户'}
                        />
                    </div>
                    {search.results.map(u => (
                        <UserRow key={u.uid} user={u} onClick={() => {
                            onSelect(u);
                            onManualNameChange?.('');
                            onManualLinkChange?.('');
                            search.setQuery('');
                            search.clear();
                        }}/>
                    ))}
                    {search.failed && (
                        <p className="admin-no-results">
                            {isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。'}
                        </p>
                    )}
                    {search.hasSearched && !search.failed && search.results.length === 0 && !search.searching && (
                        <p className="admin-no-results">
                            {isEnglish
                                ? 'No users found. Names and emails match from the beginning — try their first name, or the start of their email.'
                                : '未找到用户。姓名与邮箱均从开头匹配 —— 可尝试其名字，或邮箱的开头部分。'}
                        </p>
                    )}
                    {search.results.length === 0 && !search.searching && onManualNameChange && (
                        <>
                            <label className="admin-mt-8">
                                <span>{isEnglish ? 'Or enter name manually' : '或手动输入名称'}</span>
                                <input
                                    value={manualName || ''}
                                    onChange={(e) => onManualNameChange(e.target.value)}
                                    className="admin-input"
                                    placeholder={isEnglish ? 'Creator name' : '创建者名称'}
                                />
                            </label>
                            {manualName && onManualLinkChange && (
                                <label>
                                    <span>{isEnglish ? 'Creator Link (optional)' : '创建者链接（可选）'}</span>
                                    <input
                                        value={manualLink || ''}
                                        onChange={(e) => onManualLinkChange(e.target.value)}
                                        className="admin-input"
                                        placeholder="https://..."
                                    />
                                </label>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
};
