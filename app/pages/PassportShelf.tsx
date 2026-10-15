import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fetchPassportsByOwner, type Passport, passportName, usePassportDesigns, } from '~/lib/passports';

/**
 * One passport on the shelf: its cover art, name, and whatever the surface
 * wants under it. `date` comes pre-formatted.
 */
export const PassportShelfCard = ({designId, year, date, code, to}: {
    designId: string;
    year: number;
    date?: string;
    code?: string;
    to?: string;
}) => {
    const {isEnglish} = useLanguage();
    const {designs} = usePassportDesigns();
    const design = designs.find(d => d.id === designId);
    const name = passportName(design, isEnglish);

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

    return to
        ? <Link to={to} className="passport-shelf-card">{body}</Link>
        : <div className="passport-shelf-card">{body}</div>;
};

/**
 * Every passport bound to `uid`: null in flight, `failed` on error. Pass null
 * to skip; someone else's profile has no shelf.
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
 * The owner's shelf on /profile, one card per physical passport, so duplicates
 * of a design each get their own. Loading, failure and empty are the profile
 * page's to draw.
 */
export const PassportShelf = ({passports}: {passports: Passport[]}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="passport-shelf">
            {passports.map(passport => (
                <PassportShelfCard
                    key={passport.id}
                    designId={passport.designId}
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
