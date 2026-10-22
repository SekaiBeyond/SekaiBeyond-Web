import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ConContent } from '~/lib/conContent';
import { useT } from '~/pages/con/i18n';
import {
    AddButton,
    BLANK,
    EmptyRow,
    LocalizedField,
    removeAt,
    replaceAt,
    RowActions,
    type SectionProps,
    SectionShell,
    useSectionEditor,
} from './conContentShared';

export const ScheduleSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const t = useT();
    const editor = useSectionEditor('schedule', content.schedule, loading, showToast);
    const {draft, setDraft} = editor;
    const [roomFilter, setRoomFilter] = useState<string | null>(null);

    const update = (index: number, next: ConContent['schedule'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    /**
     * Rooms the draft uses, in the Rooms section's order. An unbooked room gets no
     * chip, since its only result would be an empty list.
     */
    const booked = new Set(draft.flatMap(item => item.room ? [item.room] : []));
    const filterableRooms = content.rooms.filter(room => booked.has(room.id));

    // Derived, so a chip whose room empties falls back to showing everything.
    const activeRoom = filterableRooms.some(room => room.id === roomFilter) ? roomFilter : null;
    const filtering = activeRoom !== null;

    /**
     * Items with their real index in the draft, which every edit and delete uses,
     * so filtering can't make an edit land on a neighbour.
     */
    const visible = draft
        .map((item, index) => ({item, index}))
        .filter(({item}) => !filtering || item.room === activeRoom);

    /** "12:00 – 13:30", or the TBA marker for an item with no time yet. */
    const timeLabel = (item: ConContent['schedule'][number]) => {
        if (item.start === undefined) return isEnglish ? 'TBA' : '待定';
        return `${item.start || '--:--'} – ${item.end || '--:--'}`;
    };

    return (
        <SectionShell
            section="schedule"
            helper={{
                en: 'Everything running on the day, in one list. Times are the local clock, and the list is put in start order when you save. Rooms come from the section above, and are asked for once an item has a time — until then it shows as TBA, in no room, and sorts to the end.',
                zh: '当天的全部安排，集中在一个列表中。时间为当地时间，保存时会按开始时间排序。房间选项来自上方的板块，并在条目确定时间后才需填写——在此之前显示为「待定」，不归属任何房间，并排在最后。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            {filterableRooms.length > 1 && (
                <div className="admin-con-filter" role="group"
                     aria-label={isEnglish ? 'Filter items by room' : '按房间筛选条目'}>
                    <button
                        type="button"
                        className="admin-con-filter-chip"
                        aria-pressed={activeRoom === null}
                        onClick={() => setRoomFilter(null)}
                    >
                        {isEnglish ? 'All rooms' : '全部房间'}
                    </button>

                    {filterableRooms.map(room => (
                        <button
                            key={room.id}
                            type="button"
                            className="admin-con-filter-chip"
                            aria-pressed={activeRoom === room.id}
                            onClick={() => setRoomFilter(room.id)}
                        >
                            {t(room.name)}
                        </button>
                    ))}
                </div>
            )}

            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'Nothing scheduled yet.', zh: '暂无日程。'}}/>}

                {visible.map(({item, index}) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {item.title.en || item.title.zh
                                    || (isEnglish ? `Item ${index + 1}` : `条目 ${index + 1}`)}
                                <span className="admin-con-dirty">{timeLabel(item)}</span>
                            </span>
                            <RowActions
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={item.start === undefined}
                                    onChange={e => !readOnly && update(index, {
                                        ...item,
                                        start: e.target.checked ? undefined : '',
                                        end: e.target.checked ? undefined : '',
                                        // The room goes and comes back with the hour.
                                        room: e.target.checked
                                            ? undefined
                                            : (item.room ?? activeRoom ?? content.rooms[0]?.id ?? ''),
                                    })}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Time to be announced' : '时间待定'}</span>
                            </label>

                            {item.start !== undefined && (
                                <>
                                    <label>
                                        <span>{isEnglish ? 'Start' : '开始'}</span>
                                        <input
                                            className="admin-input"
                                            type="time"
                                            value={item.start}
                                            onChange={e => !readOnly
                                                && update(index, {...item, start: e.target.value})}
                                            readOnly={readOnly}
                                        />
                                    </label>
                                    <label>
                                        <span>{isEnglish ? 'End' : '结束'}</span>
                                        <input
                                            className="admin-input"
                                            type="time"
                                            value={item.end ?? ''}
                                            onChange={e => !readOnly
                                                && update(index, {...item, end: e.target.value})}
                                            readOnly={readOnly}
                                        />
                                    </label>
                                </>
                            )}

                            {/* Only a scheduled item picks a room: the hour and room are
                                booked together. */}
                            {item.start !== undefined && (
                                <>
                                    <label>
                                        <span>{isEnglish ? 'Room' : '房间'}</span>
                                        <select
                                            className="admin-input"
                                            value={item.room ?? ''}
                                            onChange={e => !readOnly
                                                && update(index, {...item, room: e.target.value})}
                                            disabled={readOnly}
                                        >
                                            {content.rooms.map(room => (
                                                <option key={room.id} value={room.id}>
                                                    {t(room.name)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <div/>
                                </>
                            )}

                            <LocalizedField
                                label={{en: 'Title', zh: '标题'}}
                                value={item.title}
                                onChange={next => update(index, {...item, title: next})}
                                readOnly={readOnly}
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'item', zh: '条目'}}
                    onClick={() => setDraft(prev => [...prev, {
                        start: '',
                        end: '',
                        // The filtered room, so the new row stays on screen.
                        room: activeRoom ?? content.rooms[0]?.id ?? '',
                        title: BLANK,
                    }])}
                    // Every item needs a room server-side, so without rooms the save
                    // would fail.
                    blocked={content.rooms.length === 0}
                    blockedHint={{
                        en: 'Add and save a room above before adding schedule items.',
                        zh: '请先在上方添加并保存房间，然后再添加日程条目。',
                    }}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};
