import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fetchPassportsByOwner, type Passport, passportName, usePassportDesigns, } from '~/lib/passports';

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
 * hold, and nothing else. Activating a passport is Redeem Code's job and who
 * can see the public page is the Settings tab's, so the shelf is just the shelf.
 *
 * A duplicate year gets its own card rather than a "×3" badge — each passport is
 * a separate object with its own code, its own claim date, and its own page.
 */
export const PassportShelfSection = () => {
    const {isEnglish} = useLanguage();
    const {user, profile} = useAuth();

    const [passports, setPassports] = useState<Passport[] | null>(null);
    const [loadError, setLoadError] = useState(false);

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

    const hasPassports = passports !== null && passports.length > 0;

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
            ) : hasPassports ? (
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
                        ? 'No passports yet — a physical passport adds a year of membership and a page of your own. Holding one? Enter its code under Redeem Code in the account menu.'
                        : '还没有通行证 — 一本实体通行证可为你带来一年会员资格和一个属于你的页面。已持有通行证？请在账户菜单的「兑换激活码」中输入编号。'}
                </p>
            )}
        </section>
    );
};
