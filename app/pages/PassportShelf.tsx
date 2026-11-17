import { Link } from 'react-router';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetMyPassports } from '~/lib/firebase';
import { passportName, type ShelfPassport, usePassportDesigns } from '~/lib/passports';

const PassportShelfCard = ({designId, year, date, code, to}: {
    designId: string;
    year: number;
    date?: string;
    code: string;
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

export const fetchOwnPassports = async (): Promise<ShelfPassport[]> =>
    (await callGetMyPassports()).data.passports.map(p => ({
        ...p,
        claimedAt: p.claimedAt ? new Date(p.claimedAt) : null,
    }));

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
