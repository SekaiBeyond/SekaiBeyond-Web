import { useState } from 'react';
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
 *
 * Location is optional: the "Set a custom location" checkbox toggles the free-text fields.
 * When unchecked the location text is cleared and the linked venue's name is shown instead
 * (see `eventLocationDisplay`).
 */
export const LocationFormField = ({
                                      value, valueCn, venueId,
                                      onChange, onChangeCn, onChangeVenueId,
                                      placeholder, placeholderCn,
                                  }: LocationFormFieldProps) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [enabled, setEnabled] = useState(Boolean(value || valueCn));

    const toggleEnabled = (checked: boolean) => {
        setEnabled(checked);
        // Clearing the text makes the linked venue the displayed location.
        if (!checked) {
            onChange('');
            onChangeCn('');
        }
    };

    return (
        <>
            <label className="admin-form-grid-full admin-checkbox-label">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => toggleEnabled(e.target.checked)}
                />
                <span>{isEnglish ? 'Set a custom location' : '设置自定义地点'}</span>
            </label>
            {enabled ? (
                <BilingualFormField
                    label="Location" labelCn="地点"
                    value={value} valueCn={valueCn}
                    onChange={onChange} onChangeCn={onChangeCn}
                    placeholder={placeholder}
                    placeholderCn={placeholderCn}
                />
            ) : (
                <p className="admin-form-grid-full admin-title-hint">
                    {isEnglish
                        ? 'No custom location — the selected venue’s name will be shown instead.'
                        : '未设置自定义地点 — 将改为显示所选场地的名称。'}
                </p>
            )}
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
