import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';
import { docToUserRecord } from './utils';

interface CreatorPickerProps {
    selected: UserRecord | null;
    onSelect: (user: UserRecord | null) => void;
    manualName: string;
    onManualNameChange: (name: string) => void;
    manualLink: string;
    onManualLinkChange: (link: string) => void;
}

export const CreatorPicker = ({
                                  selected,
                                  onSelect,
                                  manualName,
                                  onManualNameChange,
                                  manualLink,
                                  onManualLinkChange,
                              }: CreatorPickerProps) => {
    const {isEnglish} = useLanguage();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);

    const search = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'users'), where('email', '==', searchQuery.trim().toLowerCase()));
            const snapshot = await getDocs(q);
            setSearchResults(snapshot.docs.map(docToUserRecord));
        } finally {
            setSearching(false);
        }
    };

    return (
        <div className="admin-creator-picker">
            <span className="admin-creator-picker-label">
                {isEnglish ? 'Creator (optional)' : '创建者（可选）'}
            </span>
            {selected ? (
                <div className="admin-creator-selected">
                    <img src={selected.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
                    <div>
                        <div className="admin-user-name">{selected.displayName}</div>
                        <div className="admin-user-email">{selected.email}</div>
                    </div>
                    <button className="admin-back-btn" onClick={() => onSelect(null)}>
                        {isEnglish ? 'Clear' : '清除'}
                    </button>
                </div>
            ) : (
                <>
                    <div className="admin-creator-search-row">
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && search()}
                            className="admin-search-input"
                            placeholder={isEnglish ? 'Search user by email' : '通过邮箱搜索用户'}
                        />
                        <button onClick={search} disabled={searching} className="admin-search-btn">
                            {searching
                                ? (isEnglish ? 'Searching...' : '搜索中...')
                                : (isEnglish ? 'Search' : '搜索')}
                        </button>
                    </div>
                    {searchResults.map(u => (
                        <div key={u.uid} className="admin-user-row" onClick={() => {
                            onSelect(u);
                            onManualNameChange('');
                            onManualLinkChange('');
                            setSearchQuery('');
                            setSearchResults([]);
                        }}>
                            <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
                            <div>
                                <div className="admin-user-name">{u.displayName}</div>
                                <div className="admin-user-email">{u.email}</div>
                            </div>
                        </div>
                    ))}
                    {searchResults.length === 0 && !searching && (
                        <>
                            <label style={{marginTop: '8px'}}>
                                <span>{isEnglish ? 'Or enter name manually' : '或手动输入名称'}</span>
                                <input
                                    value={manualName}
                                    onChange={(e) => onManualNameChange(e.target.value)}
                                    className="admin-search-input"
                                    placeholder={isEnglish ? 'Creator name' : '创建者名称'}
                                />
                            </label>
                            {manualName && (
                                <label>
                                    <span>{isEnglish ? 'Creator Link (optional)' : '创建者链接（可选）'}</span>
                                    <input
                                        value={manualLink}
                                        onChange={(e) => onManualLinkChange(e.target.value)}
                                        className="admin-search-input"
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
