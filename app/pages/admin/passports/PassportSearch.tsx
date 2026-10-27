import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    fetchPassport,
    fetchPassportsByOwner,
    isPassportCodeShape,
    type Passport,
    PASSPORT_ID_LENGTH,
    type PassportDesign,
    passportName,
    passportStatusLabel,
} from '~/lib/passports';
import { PRIVACY_ROWS } from '~/lib/privacy';
import { searchUsers, type ShowToast } from '../utils';
import type { UserRecord } from '../types';

interface PassportSearchProps {
    designs: PassportDesign[];
    onOpen: (id: string) => void;
    showToast: ShowToast;
}

/**
 * Look up a passport by its sticker code or its owner: a 10-character code
 * resolves directly; anything else is matched against users, and each match's
 * passports are listed.
 */
export const PassportSearch = ({designs, onOpen, showToast}: PassportSearchProps) => {
    const {isEnglish} = useLanguage();
    const [term, setTerm] = useState('');
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<{passport: Passport; owner?: UserRecord}[] | null>(null);

    const run = async () => {
        const query = term.trim();
        if (!query) return;
        setBusy(true);
        setResults(null);
        try {
            if (isPassportCodeShape(query, PASSPORT_ID_LENGTH)) {
                const passport = await fetchPassport(query);
                setResults(passport ? [{passport}] : []);
                return;
            }
            // Up to 30 matches, whose passports are fetched together.
            const owners = await searchUsers(query);
            const perOwner = await Promise.all(owners.map(owner => fetchPassportsByOwner(owner.uid)));
            setResults(owners.flatMap((owner, i) => perOwner[i].map(passport => ({passport, owner}))));
        } catch {
            showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="admin-field-section admin-section-mb">
            <span className="admin-field-label">{isEnglish ? 'Find a Passport' : '查找通行证'}</span>
            <div className="admin-title-input-row">
                <input
                    className="admin-input admin-input--sm"
                    value={term}
                    onChange={e => setTerm(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') void run();
                    }}
                    placeholder={isEnglish ? 'Passport code, name, or email' : '通行证编号、姓名或邮箱'}
                />
                <button className="admin-btn admin-btn--cta" onClick={() => void run()} disabled={busy || !term.trim()}>
                    {busy ? (isEnglish ? 'Searching...' : '搜索中...') : (isEnglish ? 'Search' : '搜索')}
                </button>
                {results !== null && (
                    <button
                        className="admin-btn admin-btn--outline"
                        onClick={() => {
                            setResults(null);
                            setTerm('');
                        }}
                    >
                        {isEnglish ? 'Clear' : '清除'}
                    </button>
                )}
            </div>
            {results !== null && (results.length === 0 ? (
                <p className="admin-no-results">{isEnglish ? 'No passports found.' : '未找到通行证。'}</p>
            ) : (
                <div className="admin-passport-results">
                    {results.map(({passport, owner}) => (
                        <PassportRow
                            key={passport.id}
                            passport={passport}
                            designs={designs}
                            detail={owner ? `${owner.displayName} (${owner.email})` : ''}
                            onOpen={onOpen}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
};

interface PassportRowProps {
    passport: Passport;
    designs: PassportDesign[];
    /** Appended to the year and design name, when not blank. */
    detail: string;
    onOpen: (id: string) => void;
}

/**
 * Whether scanning a holder's passports shows their page or a private notice,
 * as they set it on their profile.
 */
export const PassportPageTag = ({hidden}: {hidden: boolean}) => {
    const {isEnglish} = useLanguage();
    // The member's own wording for the setting, from their Settings tab.
    const row = PRIVACY_ROWS.find(r => r.key === 'passportPage');
    const meaning = row && (hidden ? row.off : row.on);
    return (
        <span
            className={`admin-qr-badge admin-qr-badge-lg admin-passport-badge--${hidden ? 'private' : 'public'}`}
            title={meaning ? (isEnglish ? meaning.en : meaning.zh) : undefined}
        >
            {hidden
                ? (isEnglish ? 'Private page' : '私密页面')
                : (isEnglish ? 'Public page' : '公开页面')}
        </span>
    );
};

/** One passport as a clickable row, here and on a user's admin page. */
export const PassportRow = ({passport, designs, detail, onOpen}: PassportRowProps) => {
    const {isEnglish} = useLanguage();
    return (
        <button className="admin-qr-row" onClick={() => onOpen(passport.id)} type="button">
            <span className="admin-qr-row-main">
                <span className="admin-qr-row-title">
                    {passport.id}
                    <span className={`admin-qr-badge admin-passport-badge--${passport.status}`}>
                        {passportStatusLabel(passport.status, isEnglish)}
                    </span>
                </span>
                <span className="admin-qr-row-sub">
                    {passport.year} · {passportName(designs.find(d => d.id === passport.designId), isEnglish)}
                    {detail ? ` · ${detail}` : ''}
                </span>
            </span>
        </button>
    );
};
