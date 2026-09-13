import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fetchPassportsByOwner, type Passport, passportName, usePassportDesigns, } from '~/lib/passports';

/**
 * One passport on the shelf: its year's cover art, its name, and whatever the
 * surface wants under it.
 *
 * `date` arrives pre-formatted so the caller decides how to word it.
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
 * Every passport bound to `uid`: null while the read is in flight, and `failed`
 * if it didn't land. Pass null to skip the read — someone else's profile has no
 * shelf, since getPublicProfile carries none of it.
 */
export function usePassportsByOwner(uid: string | null): {passports: Passport[] | null; failed: boolean} {
    const [passports, setPassports] = useState<Passport[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setPassports(null);
        setFailed(false);
        if (!uid) return;
        let stale = false;
        fetchPassportsByOwner(uid)
            .then(list => {
                if (!stale) setPassports(list);
            })
            .catch(() => {
                if (!stale) setFailed(true);
            });
        return () => {
            stale = true;
        };
    }, [uid]);

    return {passports, failed};
}

/**
 * The owner's passport shelf on /profile: one card per physical passport they
 * hold. Loading, failure and the empty shelf are the profile page's to draw, the
 * same as for its other sections.
 *
 * A duplicate year gets its own card rather than a "×3" badge — each passport is
 * a separate object with its own code, its own claim date, and its own page.
 */
export const PassportShelf = ({passports}: {passports: Passport[]}) => {
    const {isEnglish} = useLanguage();
    return (
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
    );
};
