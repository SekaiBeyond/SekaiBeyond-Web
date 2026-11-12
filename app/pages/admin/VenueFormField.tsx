import { useLanguage } from '~/components/LanguageContextProvider';
import { localized } from '~/lib/localized';
import { localizedVenueName, resolveVenueById, useVenues, venueLocationName } from '~/lib/venues';

/** Where an event is: a venue, and which of its rooms, if any. */
interface VenuePick {
    venueId: string;
    roomIds: string[];
}

interface VenueFormFieldProps {
    value: VenuePick;
    onChange: (next: VenuePick) => void;
    /** The saved event's location text, or '' for a new event. */
    location?: string;
    locationCn?: string;
}

/**
 * Event-editor venue selector, with the venue's rooms to pick from, none of which
 * have to be. The venue's name and rooms are the event's location, and the venue
 * gives it its parking guide. An event without one shows its location text, if it
 * has any (see `eventLocationDisplay`), which saving with a venue clears.
 */
export const VenueFormField = ({value, onChange, location = '', locationCn = ''}: VenueFormFieldProps) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const venue = resolveVenueById(value.venueId, venues);
    const leftover = localized(isEnglish, location, locationCn).trim();

    // Kept in the venue's order, the order the location lists them in.
    const toggleRoom = (roomId: string) => {
        if (!venue) return;
        const picked = new Set(value.roomIds);
        if (picked.has(roomId)) picked.delete(roomId);
        else picked.add(roomId);
        onChange({venueId: value.venueId, roomIds: venue.rooms.filter(r => picked.has(r.id)).map(r => r.id)});
    };

    return (
        <>
            <label className="admin-form-grid-full">
                <span>{isEnglish ? 'Venue' : '场地'}</span>
                <select
                    value={value.venueId}
                    // Rooms belong to a venue, so another venue starts with none.
                    onChange={e => onChange({venueId: e.target.value, roomIds: []})}
                    className="admin-input"
                >
                    <option value="">
                        {isEnglish ? '— None (no location or parking guide) —' : '— 无（不显示地点和停车指南）—'}
                    </option>
                    {venues.map(v => (
                        <option key={v.id} value={v.id}>
                            {localizedVenueName(v, isEnglish)}
                        </option>
                    ))}
                </select>
            </label>
            {venue && venue.rooms.length > 0 && (
                // A div, not a <label>, so clicking the heading doesn't toggle the first chip.
                <div className="admin-tag-field">
                    <span>{isEnglish ? 'Rooms (optional)' : '房间（可选）'}</span>
                    <div className="admin-tag-chips">
                        {venue.rooms.map(r => {
                            const active = value.roomIds.includes(r.id);
                            return (
                                <button
                                    type="button"
                                    key={r.id}
                                    className={`admin-tag-chip${active ? ' admin-tag-chip-active' : ''}`}
                                    onClick={() => toggleRoom(r.id)}
                                    aria-pressed={active}
                                >
                                    {localized(isEnglish, r.nameEn, r.nameCn)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            <p className="admin-form-grid-full admin-title-hint">
                {venue
                    ? (isEnglish
                        ? `Its location shows as “${venueLocationName(venue, value.roomIds, isEnglish)}”.`
                        : `地点将显示为“${venueLocationName(venue, value.roomIds, isEnglish)}”。`)
                    : value.venueId
                        ? (isEnglish
                            ? 'The venue’s name and rooms show as the event’s location.'
                            : '场地名称和房间将作为活动地点显示。')
                        : leftover
                            ? (isEnglish
                                ? `Shows “${leftover}” as its location until you pick a venue.`
                                : `选择场地前，地点显示为“${leftover}”。`)
                            : (isEnglish
                                ? 'Pick a venue to show the event’s location. Add venues and their rooms in the Locations tab.'
                                : '选择场地以显示活动地点。可在“场地管理”中添加场地及其房间。')}
            </p>
        </>
    );
};
