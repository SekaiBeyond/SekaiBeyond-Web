import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    fetchPassportsByOwner,
    type Passport,
    passportName,
    type ShelfPassport,
    usePassportDesigns,
} from '~/lib/passports';

const PassportShelfCard = ({designId, year, date, code, to}: {
    designId: string;
    year: number;
    date?: string;
    code: string;
    /** Left off when the passport page is private, rather than link to its notice. */
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
            <span className="passport-shelf-code">{code}</span>
        </>
    );
    return to
        ? <Link to={to} className="passport-shelf-card">{body}</Link>
        : <div className="passport-shelf-card">{body}</div>;
};

/**
 * Every passport bound to `uid`: null in flight, `failed` on error. Pass null
 * to skip; someone else's shelf comes with their public profile.
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
 * A member's shelf on /profile, one card per physical passport, so duplicates
 * of a design each get their own. Each links to its passport page unless the
 * holder made that private. Loading, failure, private and empty are the profile
 * page's to draw.
 */
export const PassportShelf = ({passports, linked = true}: {passports: ShelfPassport[]; linked?: boolean}) => {
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
                    to={linked ? `/p/${passport.id}` : undefined}
                />
            ))}
        </div>
    );
};
