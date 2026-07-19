import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';
import { searchUsers } from './utils';

interface AccountPickerProps {
    selected: UserRecord | null;
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
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [failed, setFailed] = useState(false);

    const search = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setFailed(false);
        try {
            setSearchResults(await searchUsers(searchQuery));
        } catch {
            setSearchResults([]);
            setFailed(true);
        } finally {
            setSearching(false);
            setHasSearched(true);
        }
    };

    return (
        <div className="admin-creator-picker">
            {label && (
                <span className="admin-creator-picker-label">
                    {label}
                </span>
            )}
            {selected ? (
                <div className="admin-creator-selected">
                    <img src={selected.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
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
                        <input
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setHasSearched(false);
                                setFailed(false);
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && search()}
                            className="admin-input"
                            placeholder={isEnglish ? 'Search user by name or email' : '通过姓名或邮箱搜索用户'}
                        />
                        <button onClick={search} disabled={searching} className="admin-btn admin-btn--cta">
                            {searching
                                ? (isEnglish ? 'Searching...' : '搜索中...')
                                : (isEnglish ? 'Search' : '搜索')}
                        </button>
                    </div>
                    {searchResults.map(u => (
                        <div key={u.uid} className="admin-user-row" onClick={() => {
                            onSelect(u);
                            onManualNameChange?.('');
                            onManualLinkChange?.('');
                            setSearchQuery('');
                            setSearchResults([]);
                            setHasSearched(false);
                        }}>
                            <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
                            <div>
                                <div className="admin-user-name">{u.displayName}</div>
                                <div className="admin-user-email">{u.email}</div>
                            </div>
                        </div>
                    ))}
                    {failed && (
                        <p className="admin-no-results">
                            {isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。'}
                        </p>
                    )}
                    {/* Both fields match from the start, so say so rather than leaving a
                        mid-word search looking like the account does not exist. */}
                    {hasSearched && !failed && searchResults.length === 0 && !searching && (
                        <p className="admin-no-results">
                            {isEnglish
                                ? 'No users found. Names and emails match from the beginning — try their first name, or the start of their email.'
                                : '未找到用户。姓名与邮箱均从开头匹配 —— 可尝试其名字，或邮箱的开头部分。'}
                        </p>
                    )}
                    {searchResults.length === 0 && !searching && onManualNameChange && (
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
