import { useLanguage } from '~/components/LanguageContextProvider';

interface ConEditionFieldProps {
    value: boolean;
    onChange: (next: boolean) => void;
    /** The event's date, `YYYY-MM-DD…`, or '' before one is set. */
    date: string;
}

/**
 * The event form's "this is that year's Sekai Beyond Con" box. There's one a
 * year, so the server takes the year from the date; this only says which.
 */
export const ConEditionField = ({value, onChange, date}: ConEditionFieldProps) => {
    const {isEnglish} = useLanguage();
    const year = /^\d{4}-/.test(date) ? date.slice(0, 4) : null;

    return (
        <div className="admin-form-grid-full">
            <label className="admin-checkbox-label">
                <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}/>
                <span>{isEnglish ? 'Sekai Beyond Con edition' : '彼世界动漫游戏展年度活动'}</span>
            </label>
            <p className="admin-title-hint">
                {isEnglish
                    ? 'Shows as the year of its date in the home page’s Sekai Beyond Con section, with this event’s description, poster, date and location, and once archived, under Sekai Beyond Con in Past Events. One event per year.'
                    : '按活动日期所在年份在主页“彼世界动漫游戏展”板块中展示，使用此活动的描述、海报、日期和地点；归档后列于往期活动的“彼世界动漫游戏展”分组。每年仅限一个活动。'}
            </p>
            {value && (
                <p className="admin-title-hint">
                    {year
                        ? (isEnglish ? `Saves as Sekai Beyond Con ${year}.` : `将保存为 ${year} 年彼世界动漫游戏展。`)
                        : (isEnglish ? 'Its year comes from the date.' : '年份取自活动日期。')}
                </p>
            )}
        </div>
    );
};
