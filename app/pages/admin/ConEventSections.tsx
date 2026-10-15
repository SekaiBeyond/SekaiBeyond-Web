import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadConVideo } from '~/lib/firebase';
import { type ConContent, HIDEABLE_SECTIONS, ROOM_ACCENTS, type RoomAccent, } from '~/lib/conContent';
import { formatSiteTime } from '~/lib/siteTime';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { useUploadLimits } from '~/lib/uploadLimits';
import { useVenues } from '~/lib/venues';
import type { Localized } from '~/pages/con/i18n';
import { validateVideoFile } from './utils';
import {
    AddButton,
    BLANK,
    EmptyRow,
    LocalizedField,
    moveAt,
    newRowId,
    removeAt,
    replaceAt,
    RowActions,
    SECTION_LABELS,
    type SectionProps,
    SectionShell,
    setHidden,
    useSectionEditor,
} from './conContentShared';

export const EventSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('event', content.event, loading, showToast);
    const {draft, setDraft} = editor;
    const {venues} = useVenues();
    const {upcomingEvents, loading: eventsLoading} = useAllUpcomingEvents();

    const set = <K extends keyof typeof draft, >(key: K, value: typeof draft[K]) =>
        setDraft(prev => ({...prev, [key]: value}));

    const linked = upcomingEvents.find(e => e.id === draft.upcomingEventId) ?? null;
    const none = isEnglish ? 'none' : '无';
    const when = (date: Date) => formatSiteTime(date, isEnglish, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const venueName = (id: string) => {
        if (!id) return none;
        const venue = venues.find(v => v.id === id);
        if (!venue) return isEnglish ? '(Deleted venue)' : '（已删除的场地）';
        return isEnglish ? venue.nameEn : (venue.nameCn || venue.nameEn);
    };

    return (
        <SectionShell
            section="event"
            helper={{
                en: 'The tagline and intro in the hero, and the upcoming event whose year, dates, venue and ticket link the hero, the countdown, the navbar button and the venue card show.',
                zh: '首屏中的标语与简介，以及对应的活动预告——首屏、倒计时、导航栏按钮与场地卡片展示该活动的年份、日期、场地与购票链接。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <LocalizedField
                    label={{en: 'Tagline', zh: '标语'}}
                    value={draft.tagline}
                    onChange={next => set('tagline', next)}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Intro', zh: '简介'}}
                    value={draft.intro}
                    onChange={next => set('intro', next)}
                    readOnly={readOnly}
                    multiline
                />

                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Upcoming event' : '对应的活动预告'}</span>
                    <select
                        className="admin-input"
                        value={draft.upcomingEventId}
                        onChange={e => !readOnly && set('upcomingEventId', e.target.value)}
                        disabled={readOnly}
                    >
                        <option value="">{isEnglish ? '— Select the con’s event —' : '— 选择漫展对应的活动 —'}</option>
                        {/* An archived or deleted event still shows as the current value,
                            or the select would read blank. */}
                        {draft.upcomingEventId && !eventsLoading && !linked && (
                            <option value={draft.upcomingEventId}>
                                {isEnglish ? '(Archived or deleted event)' : '（已归档或删除的活动）'}
                            </option>
                        )}
                        {upcomingEvents.map(e => (
                            <option key={e.id} value={e.id}>
                                {`${isEnglish ? e.title : (e.titleCn || e.title)} · ${formatSiteTime(e.startAt, isEnglish, {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                })}${e.published ? '' : (isEnglish ? ' (unpublished)' : '（未发布）')}`}
                            </option>
                        ))}
                    </select>
                    <span className="admin-helper-text admin-mt-4">
                        {isEnglish
                            ? 'The con’s dates, venue and ticket link come from this event, and the year in the hero from when it starts: edit them in the Upcoming Events tab. The con page’s parking button opens its parking guide.'
                            : '漫展的日期、场地与购票链接均来自该活动，首屏中的年份取自其开始时间，请在「活动预告」标签页中编辑。漫展页面的停车按钮将打开该活动的停车指南。'}
                    </span>
                    {linked && (
                        <span className="admin-helper-text admin-mt-4">
                            {isEnglish ? 'Runs' : '时间'}: {when(linked.startAt)} – {when(linked.endAt)}
                            <br/>
                            {isEnglish ? 'Venue' : '场地'}: {venueName(linked.venueId)}
                            <br/>
                            {isEnglish ? 'Ticket link' : '购票链接'}: {linked.buyTicket || none}
                        </span>
                    )}
                    {linked && !linked.published && (
                        <span className="admin-helper-text admin-mt-4 admin-con-warning">
                            {isEnglish
                                ? 'This event is unpublished. Staff previews show its details, but until it’s published the public con page shows no date, venue or ticket link, and its parking guide opens on right now.'
                                : '该活动尚未发布。工作人员预览可见其信息，但在发布前，公开的漫展页面不会显示日期、场地与购票链接，停车指南也将显示当前情况。'}
                        </span>
                    )}
                </label>
            </div>
        </SectionShell>
    );
};

interface ClipFieldProps {
    url: string;
    uploading: boolean;
    disabled: boolean;
    onPick: (file: File) => void;
    onClear: () => void;
    readOnly?: boolean;
}

const ClipField = ({url, uploading, disabled, onPick, onClear, readOnly}: ClipFieldProps) => {
    const {isEnglish} = useLanguage();

    return (
        <div className="admin-con-item">
            <div className="admin-con-card-head">
                <span className="admin-con-card-title">
                    {isEnglish ? 'Looping clip (WebM)' : '循环视频（WebM）'}
                    {uploading && (
                        <span className="admin-con-dirty">{isEnglish ? 'Uploading...' : '上传中...'}</span>
                    )}
                </span>
            </div>

            {url ? (
                // Looping like the hero, so the loop point, invisible in a still,
                // can be checked.
                <video className="admin-video-cover-preview" src={url} muted loop autoPlay playsInline/>
            ) : (
                <p className="admin-helper-text admin-mt-4">
                    {isEnglish ? 'Nothing uploaded yet.' : '尚未上传。'}
                </p>
            )}

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <label className={`admin-btn admin-btn--chip admin-avatar-choose${
                        disabled ? ' admin-avatar-choose-busy' : ''}`}>
                        <input
                            type="file"
                            accept="video/webm,.webm"
                            disabled={disabled}
                            onChange={e => {
                                const file = e.target.files?.[0];
                                // Cleared so picking the same file again still
                                // fires a change.
                                e.target.value = '';
                                if (file) onPick(file);
                            }}
                        />
                        {url
                            ? (isEnglish ? 'Replace clip' : '更换视频')
                            : (isEnglish ? 'Choose clip' : '选择视频')}
                    </label>
                    {url && (
                        <button
                            className="admin-btn admin-btn--chip admin-btn-sm"
                            onClick={onClear}
                            disabled={disabled}
                        >
                            {isEnglish ? 'Remove' : '移除'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export const HeroVideoSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const {videoMb} = useUploadLimits();
    const editor = useSectionEditor('heroVideo', content.heroVideo, loading, showToast);
    const {draft, setDraft} = editor;
    /** True while the clip uploads; Save waits for it rather than going out without it. */
    const [busy, setBusy] = useState(false);

    const uploadClip = async (file: File) => {
        if (!validateVideoFile(file, videoMb, isEnglish, showToast)) return;
        setBusy(true);
        try {
            showToast(isEnglish ? 'Uploading clip...' : '正在上传视频...', 'warning');
            // Time-stamped: the published page serves the old URL until this saves,
            // and overwriting it would swap the live clip early.
            const url = await callUploadConVideo(file, `con/hero-${Date.now().toString(36)}.webm`);
            setDraft(prev => ({...prev, webm: url}));
            showToast(isEnglish ? 'Clip uploaded.' : '视频已上传。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Clip upload failed.' : '视频上传失败。'), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <SectionShell
            section="heroVideo"
            helper={{
                en: 'The looping WebM clip behind the hero. With no clip the hero shows a gradient.',
                zh: '首屏背后的 WebM 循环视频。未上传视频时，首屏显示渐变背景。',
            }}
            editor={editor}
            busy={busy}
            busyLabel={{en: 'Waiting for the upload...', zh: '正在等待上传...'}}
            readOnly={readOnly}
        >
            <p className="admin-helper-text">
                {isEnglish
                    ? `Export a 10–20 second silent cut as WebM/VP9. 720p is plenty — a dark scrim and blurred `
                    + `highlights sit over it, so detail is not visible. Aim for a couple of MB; `
                    + `${videoMb} MB is the hard limit. Make the first and last frames match, or the `
                    + `loop point will read as a jump.`
                    : `请导出 10–20 秒的无声片段，格式为 WebM/VP9。720p 已足够——视频上方覆盖有深色遮罩与模糊光晕，`
                    + `细节不可见。建议控制在几 MB 以内，上限为 ${videoMb} MB。`
                    + `请让首尾画面衔接一致，否则循环处会出现明显跳帧。`}
            </p>

            <div className="admin-con-list admin-mt-12">
                <ClipField
                    url={draft.webm}
                    uploading={busy}
                    disabled={busy}
                    onPick={uploadClip}
                    onClear={() => setDraft(prev => ({...prev, webm: ''}))}
                    readOnly={readOnly}
                />
            </div>

            {!draft.webm && (
                <p className="admin-helper-text admin-mt-12">
                    {isEnglish
                        ? 'No clip uploaded — the hero is currently showing a gradient.'
                        : '尚未上传视频——首屏当前显示的是渐变背景。'}
                </p>
            )}
        </SectionShell>
    );
};

export const SettingsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('settings', content.settings, loading, showToast);
    const {draft, setDraft} = editor;

    return (
        <SectionShell
            section="settings"
            helper={{
                en: 'While the page is unpublished, visitors get a short “coming soon” card and none of the content below leaves the admin panel. Staff, core staff and the president still see the real page, with a banner along the bottom.',
                zh: '未发布时，访客将看到简短的「敬请期待」提示页，下方内容不会离开管理面板。工作人员、核心成员与社长仍可查看真实页面，底部会显示提示横幅。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <label className="admin-checkbox-label">
                <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={e => !readOnly && setDraft(prev => ({...prev, published: e.target.checked}))}
                    disabled={readOnly}
                />
                <span>
                    {isEnglish
                        ? 'Publish the con page at /con'
                        : '在 /con 公开发布漫展页面'}
                </span>
            </label>

            <p className={`admin-helper-text admin-mt-8${draft.published ? '' : ' admin-con-warning'}`}>
                {draft.published
                    ? (isEnglish ? 'Currently visible to everyone.' : '当前对所有人可见。')
                    : (isEnglish
                        ? 'Hidden from the public, and the saved copy is staff-only until you publish — safe for an unannounced line-up.'
                        : '当前对公众隐藏，且在发布前已保存的内容仅工作人员可见——可安全用于尚未公布的阵容。')}
            </p>

            <p className="admin-helper-text admin-mt-12">
                {isEnglish
                    ? 'Sections to show. An unticked section leaves the page, the navbar and the footer, and its saved copy stays staff-only, so it can be filled in before it is announced.'
                    : '要显示的板块。取消勾选的板块将从页面、导航栏与页脚中移除，其已保存的内容仅工作人员可见，可在公布前先行填写。'}
            </p>
            {HIDEABLE_SECTIONS.map(section => (
                <label key={section} className="admin-checkbox-label admin-mt-8">
                    <input
                        type="checkbox"
                        checked={!draft.hiddenSections.includes(section)}
                        onChange={e => !readOnly && setDraft(prev => ({
                            ...prev,
                            hiddenSections: setHidden(prev.hiddenSections, section, !e.target.checked),
                        }))}
                        disabled={readOnly}
                    />
                    <span>{isEnglish ? SECTION_LABELS[section].en : SECTION_LABELS[section].zh}</span>
                </label>
            ))}
        </SectionShell>
    );
};

const ACCENT_LABELS: Record<RoomAccent, Localized> = {
    pink: {en: 'Pink', zh: '粉色'},
    violet: {en: 'Violet', zh: '紫色'},
    amber: {en: 'Amber', zh: '琥珀'},
    sky: {en: 'Sky', zh: '天蓝'},
    mint: {en: 'Mint', zh: '薄荷'},
    slate: {en: 'Slate', zh: '石灰'},
};

export const RoomsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('rooms', content.rooms, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['rooms'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    /** How many schedule items point at a room — deleting one is not free. */
    const usageOf = (id: string) =>
        content.schedule.filter(item => item.room === id).length;

    return (
        <SectionShell
            section="rooms"
            helper={{
                en: 'The rooms and stages your programming runs in. Each schedule item picks one, and its colour is the chip shown on the schedule. Renaming a room is safe — items track the room itself, not what it is called. Removing one the schedule still uses is refused; reassign those items first.',
                zh: '活动所使用的房间与舞台。每个日程条目需选择其一，颜色即日程表上显示的标签配色。重命名房间是安全的——条目关联的是房间本身，而非名称。若日程仍在使用某房间，删除将被拒绝，请先重新指派这些条目。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No rooms yet.', zh: '暂无房间。'}}/>}

                {draft.map((room, index) => {
                    const used = usageOf(room.id);
                    return (
                        <div key={index} className="admin-con-card">
                            <div className="admin-con-card-head">
                                <span className="admin-con-card-title">
                                    {room.name.en || (isEnglish ? `Room ${index + 1}` : `房间 ${index + 1}`)}
                                    {used > 0 && (
                                        <span className="admin-con-dirty">
                                            {isEnglish
                                                ? `used by ${used} item${used === 1 ? '' : 's'}`
                                                : `${used} 个条目正在使用`}
                                        </span>
                                    )}
                                </span>
                                <RowActions
                                    index={index}
                                    count={draft.length}
                                    onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                    onRemove={() => setDraft(prev => removeAt(prev, index))}
                                    readOnly={readOnly}
                                />
                            </div>

                            <div className="admin-form-grid">
                                <LocalizedField
                                    label={{en: 'Room name', zh: '房间名称'}}
                                    value={room.name}
                                    onChange={next => update(index, {...room, name: next})}
                                    readOnly={readOnly}
                                />
                                <label>
                                    <span>{isEnglish ? 'Chip colour' : '标签配色'}</span>
                                    <select
                                        className="admin-input"
                                        value={room.accent}
                                        onChange={e => !readOnly && update(index, {
                                            ...room,
                                            accent: e.target.value as RoomAccent,
                                        })}
                                        disabled={readOnly}
                                    >
                                        {ROOM_ACCENTS.map(accent => (
                                            <option key={accent} value={accent}>
                                                {isEnglish ? ACCENT_LABELS[accent].en : ACCENT_LABELS[accent].zh}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>
                    );
                })}

                <AddButton
                    label={{en: 'room', zh: '房间'}}
                    onClick={() => setDraft(prev => [...prev, {
                        id: newRowId('room'),
                        name: BLANK,
                        accent: ROOM_ACCENTS[prev.length % ROOM_ACCENTS.length],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};
