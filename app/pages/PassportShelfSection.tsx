import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    fetchPassportsByOwner,
    isPassportCodeShape,
    normalizePassportCode,
    type Passport,
    PASSPORT_ID_LENGTH,
    passportName,
    usePassportDesigns,
    usePassportPrivacy,
} from '~/lib/passports';
import type { ShowToast } from '~/pages/admin/utils';

/**
 * One passport on a shelf: its year's cover art, its name, and whatever the
 * surface wants under it. Shared by the owner's shelf on /profile (which links
 * to each passport and prints its code) and the collection strip on a public
 * passport page (which links nowhere and marks the one being viewed).
 *
 * `date` arrives pre-formatted because the two surfaces word it differently.
 */
export const PassportShelfCard = ({year, date, code, to, current}: {
    year: number;
    date?: string;
    code?: string;
    to?: string;
    current?: boolean;
}) => {
    const {isEnglish} = useLanguage();
    const {designs} = usePassportDesigns();
    const design = designs.find(d => d.year === year);
    const name = passportName(year, isEnglish);

    const body = (
        <>
            {design?.coverImageUrl ? (
                <img src={design.coverImageUrl} alt={name} className="passport-shelf-cover"/>
            ) : (
                <div className="passport-shelf-cover passport-shelf-cover--blank">{year}</div>
            )}
            <span className="passport-shelf-name">{name}</span>
            {date && <span className="passport-shelf-date">{date}</span>}
            {code && <span className="passport-shelf-code">{code}</span>}
        </>
    );

    const className = `passport-shelf-card${current ? ' passport-shelf-card--current' : ''}`;
    return to
        ? <Link to={to} className={className}>{body}</Link>
        : <div className={className}>{body}</div>;
};

/**
 * The owner's passport shelf on /profile: one card per physical passport they
 * hold, the visibility switch for the public page, and a way in for someone
 * holding a passport who hasn't scanned the sticker.
 *
 * A duplicate year gets its own card rather than a "×3" badge — each passport is
 * a separate object with its own code, its own claim date, and its own page.
 */
export const PassportShelfSection = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {user, profile} = useAuth();
    const {saving: savingPrivacy, setPrivacy} = usePassportPrivacy(showToast);
    const navigate = useNavigate();

    const [passports, setPassports] = useState<Passport[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [editingPrivacy, setEditingPrivacy] = useState(false);
    const [activateCode, setActivateCode] = useState('');

    const uid = user?.uid;

    useEffect(() => {
        if (!uid) return;
        let stale = false;
        setLoadError(false);
        fetchPassportsByOwner(uid)
            .then(list => {
                if (!stale) setPassports(list);
            })
            .catch(() => {
                if (!stale) setLoadError(true);
            });
        return () => {
            stale = true;
        };
    }, [uid]);

    if (!profile) return null;

    const hidden = profile.hidePassportPage;

    const codeReady = isPassportCodeShape(activateCode, PASSPORT_ID_LENGTH);
    const openActivate = () => {
        if (codeReady) navigate(`/p/${normalizePassportCode(activateCode)}`);
    };

    return (
        <section className="badge-section">
            <h2 className="badge-section-title">{isEnglish ? 'Passports' : '通行证'}</h2>

            {loadError && (
                <p className="profile-load-error">
                    {isEnglish ? 'Failed to load your passports.' : '加载通行证失败。'}
                </p>
            )}

            {passports === null && !loadError ? (
                <div className="spinner spinner-centered"/>
            ) : passports && passports.length > 0 ? (
                <div className="passport-shelf">
                    {passports.map(passport => (
                        <PassportShelfCard
                            key={passport.id}
                            year={passport.year}
                            date={passport.claimedAt?.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                year: 'numeric', month: 'short', day: 'numeric',
                            })}
                            code={passport.id}
                            to={`/p/${passport.id}`}
                        />
                    ))}
                </div>
            ) : !loadError && (
                <p className="profile-empty-state">
                    {isEnglish
                        ? 'No passports yet — a physical passport adds a year of membership and a page of your own.'
                        : '还没有通行证 — 一本实体通行证可为你带来一年会员资格和一个属于你的页面。'}
                </p>
            )}

            <div className="passport-profile-rows">
                {/* Visibility follows the panel-wide convention: the state reads as
                    text, and the control only appears once it is asked for. */}
                <div className="passport-profile-row">
                    <span className="passport-profile-row-label">
                        {isEnglish ? 'Passport page' : '通行证页面'}
                    </span>
                    <span className="passport-profile-row-value">
                        {hidden
                            ? (isEnglish ? 'Private — scanners see a notice' : '私密 — 扫描者只会看到提示')
                            : (isEnglish ? 'Public — anyone who scans sees it' : '公开 — 任何扫描者都能看到')}
                    </span>
                    {!editingPrivacy ? (
                        <button
                            className="profile-name-pencil"
                            onClick={() => setEditingPrivacy(true)}
                            type="button"
                            aria-label={isEnglish ? 'Edit passport page visibility' : '编辑通行证页面可见性'}
                            title={isEnglish ? 'Edit passport page visibility' : '编辑通行证页面可见性'}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                 strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                            </svg>
                        </button>
                    ) : (
                        <span className="passport-profile-row-actions">
                            <button
                                className="admin-btn admin-btn--cta"
                                onClick={() => void setPrivacy(!hidden, () => setEditingPrivacy(false))}
                                disabled={savingPrivacy}
                                type="button"
                            >
                                {savingPrivacy
                                    ? (isEnglish ? 'Saving…' : '保存中…')
                                    : hidden
                                        ? (isEnglish ? 'Make it public' : '设为公开')
                                        : (isEnglish ? 'Make it private' : '设为私密')}
                            </button>
                            <button
                                className="admin-btn admin-btn--outline"
                                onClick={() => setEditingPrivacy(false)}
                                disabled={savingPrivacy}
                                type="button"
                            >
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </span>
                    )}
                </div>

                <div className="passport-profile-row">
                    <span className="passport-profile-row-label">
                        {isEnglish ? 'Activate a passport' : '激活通行证'}
                    </span>
                    <span className="passport-profile-row-value">
                        <input
                            className="passport-code-input"
                            value={activateCode}
                            onChange={e => setActivateCode(e.target.value.toUpperCase())}
                            onKeyDown={e => {
                                if (e.key === 'Enter') openActivate();
                            }}
                            placeholder={isEnglish ? 'Code on the sticker' : '贴纸上的编号'}
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            maxLength={PASSPORT_ID_LENGTH + 4}
                            aria-label={isEnglish ? 'Passport code' : '通行证编号'}
                        />
                    </span>
                    <span className="passport-profile-row-actions">
                        <button
                            className="admin-btn admin-btn--cta"
                            onClick={openActivate}
                            disabled={!codeReady}
                            type="button"
                        >
                            {isEnglish ? 'Continue' : '继续'}
                        </button>
                    </span>
                </div>
            </div>
        </section>
    );
};
