import { useLanguage } from '~/components/LanguageContextProvider';
import { useVenues } from '~/lib/venues';
import { BilingualFormField } from './BilingualFormField';

interface LocationFormFieldProps {
    value: string;
    valueCn: string;
    venueId: string;
    onChange: (value: string) => void;
    onChangeCn: (value: string) => void;
    onChangeVenueId: (venueId: string) => void;
    placeholder?: string;
    placeholderCn?: string;
}

/**
 * Event-editor location controls. The free-text Location fields are the per-event display
 * string (unique to each event). The separate Venue (building) selector drives the parking
 * guide via `event.venueId` — it's independent of the location text.
 */
export const LocationFormField = ({
                                      value, valueCn, venueId,
                                      onChange, onChangeCn, onChangeVenueId,
                                      placeholder, placeholderCn,
                                  }: LocationFormFieldProps) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();

    return (
        <>
            <BilingualFormField
                label="Location" labelCn="地点"
                value={value} valueCn={valueCn}
                onChange={onChange} onChangeCn={onChangeCn}
                placeholder={placeholder}
                placeholderCn={placeholderCn}
            />
            <label className="admin-form-grid-full">
                <span>{isEnglish ? 'Venue' : '场地'}</span>
                <select
                    value={venueId}
                    onChange={e => onChangeVenueId(e.target.value)}
                    className="admin-search-input"
                >
                    <option value="">
                        {isEnglish ? '— None / off-campus (no parking guide) —' : '— 无 / 校外（无停车指南）—'}
                    </option>
                    {venues.map(v => (
                        <option key={v.id} value={v.id}>
                            {isEnglish ? v.nameEn : (v.nameCn || v.nameEn)}
                        </option>
                    ))}
                </select>
            </label>
        </>
    );
};
