import { useLanguage } from '~/components/LanguageContextProvider';
import { useVenues } from '~/lib/venues';
import { BilingualFormField } from './BilingualFormField';

interface LocationFormFieldProps {
    value: string;
    valueCn: string;
    onChange: (value: string) => void;
    onChangeCn: (value: string) => void;
    placeholder?: string;
    placeholderCn?: string;
}

const CUSTOM = '__custom__';

export const LocationFormField = ({
                                      value, valueCn,
                                      onChange, onChangeCn,
                                      placeholder, placeholderCn,
                                  }: LocationFormFieldProps) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();

    const matchedVenue = venues.find(v => v.nameEn === value);
    const selectValue = matchedVenue ? matchedVenue.id : CUSTOM;

    const handleSelect = (next: string) => {
        if (next === CUSTOM) {
            onChange('');
            onChangeCn('');
            return;
        }
        const venue = venues.find(v => v.id === next);
        if (!venue) return;
        onChange(venue.nameEn);
        onChangeCn(venue.nameCn);
    };

    return (
        <>
            <label className="admin-form-grid-full">
                <span>{isEnglish ? 'Venue' : '场地'}</span>
                <select
                    value={selectValue}
                    onChange={e => handleSelect(e.target.value)}
                    className="admin-search-input"
                >
                    {venues.map(v => (
                        <option key={v.id} value={v.id}>
                            {isEnglish ? v.nameEn : (v.nameCn || v.nameEn)}
                        </option>
                    ))}
                    <option value={CUSTOM}>
                        {isEnglish ? 'Custom location…' : '自定义地点…'}
                    </option>
                </select>
            </label>
            <BilingualFormField
                label="Location" labelCn="地点"
                value={value} valueCn={valueCn}
                onChange={onChange} onChangeCn={onChangeCn}
                placeholder={placeholder}
                placeholderCn={placeholderCn}
            />
        </>
    );
};
