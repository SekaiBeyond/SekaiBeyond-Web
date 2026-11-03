import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    claimedElsewhere,
    fetchPassport,
    fetchPassportsByOwner,
    fetchPassportsSentTo,
    isPassportCodeShape,
    type Passport,
    PASSPORT_ID_LENGTH,
    type PassportDesign,
    passportName,
    passportStatusLabel,
} from '~/lib/passports';
import { PRIVACY_ROWS } from '~/lib/privacy';
import { searchUsers, type ShowToast } from '../utils';

interface PassportSearchProps {
    designs: PassportDesign[];
    onOpen: (id: string) => void;
    showToast: ShowToast;
}

/**
 * Look up a passport by its sticker code, its owner, or the address it was
 * emailed to: a 10-character code resolves directly; anything else is matched
 * against users, whose passports are listed, and against the start of emailed
 * passports' addresses, claimed or not.
 */
export const PassportSearch = ({designs, onOpen, showToast}: PassportSearchProps) => {
    const {isEnglish} = useLanguage();
    const [term, setTerm] = useState('');
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<{passport: Passport; detail: string}[] | null>(null);

    // With where it was activated when that's another address, as far as the
    // passport itself says (see claimedElsewhere).
    const sentDetail = (passport: Passport): string => {
        if (!passport.sentTo) return '';
        const sent = isEnglish ? `emailed to ${passport.sentTo}` : `发送至 ${passport.sentTo}`;
        const elsewhere = claimedElsewhere(passport, undefined);
        if (elsewhere === null) return sent;
        const shown = elsewhere || (isEnglish ? 'an account without an email address' : '无邮箱地址的账号');
        return isEnglish ? `${sent} · ⚠ activated on ${shown}` : `${sent} · ⚠ 激活账号为 ${shown}`;
    };

    const run = async () => {
        const query = term.trim();
        if (!query) return;
        setBusy(true);
        setResults(null);
        try {
            if (isPassportCodeShape(query, PASSPORT_ID_LENGTH)) {
                const passport = await fetchPassport(query);
                setResults(passport ? [{passport, detail: sentDetail(passport)}] : []);
                return;
            }
            // Up to 30 matching users, whose passports are fetched together.
            const [owners, sent] = await Promise.all([searchUsers(query), fetchPassportsSentTo(query)]);
            const perOwner = await Promise.all(owners.map(owner => fetchPassportsByOwner(owner.uid)));
            const found = owners.flatMap((owner, i) => perOwner[i].map(passport => ({
                passport,
                detail: `${owner.displayName} (${owner.email})${
                    claimedElsewhere(passport, owner.email) === null ? ''
                        : isEnglish ? ` · ⚠ emailed to ${passport.sentTo}` : ` · ⚠ 发送至 ${passport.sentTo}`}`,
            })));
            // An emailed passport its recipient claimed is already listed under
            // them.
            const listed = new Set(found.map(r => r.passport.id));
            found.push(...sent.filter(p => !listed.has(p.id)).map(passport => ({
                passport,
                detail: sentDetail(passport),
            })));
            setResults(found);
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
                    {results.map(({passport, detail}) => (
                        <PassportRow
                            key={passport.id}
                            passport={passport}
                            designs={designs}
                            detail={detail}
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
