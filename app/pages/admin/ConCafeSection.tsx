import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadAdminImage } from '~/lib/firebase';
import type { Maid } from '~/lib/conContent';
import { ImageUploadField } from './ImageUploadField';
import {
    AddButton,
    EmptyRow,
    LocalizedField,
    moveAt,
    removeAt,
    replaceAt,
    RowActions,
    type SectionProps,
    SectionShell,
    useSectionEditor,
} from './conContentShared';

/* US Letter portrait, the shape the posters are drawn and printed at, so none is
   trimmed. */
const POSTER_ASPECT = 17 / 22;
/* About twice the poster viewer's width on a laptop, so the small print stays
   readable. */
const POSTER_WIDTH = 1020;

/** What an upload in flight is for: the café's own poster, or a maid's by position. */
type PosterTarget = 'cafe' | number;

export const CafeSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('cafe', content.cafe, loading, showToast);
    const {draft, setDraft} = editor;
    /**
     * The in-flight upload's preview, held apart from the draft: the server
     * rejects `blob:` URLs, so a mid-upload save would fail the section.
     */
    const [preview, setPreview] = useState<{target: PosterTarget; url: string} | null>(null);

    const updateMaid = (index: number, next: Maid) =>
        setDraft(prev => ({...prev, maids: replaceAt(prev.maids, index, next)}));

    const uploadPoster = async (target: PosterTarget, file: File, previewUrl: string) => {
        setPreview({target, url: previewUrl});
        try {
            showToast(isEnglish ? 'Uploading poster...' : '正在上传海报...', 'warning');
            // Time-stamped, not indexed, so reordering can't point a maid at
            // another's poster.
            const url = await callUploadAdminImage(file, `con/cafe-${Date.now().toString(36)}.webp`);
            setDraft(prev => (target === 'cafe'
                ? {...prev, poster: url}
                : {...prev, maids: replaceAt(prev.maids, target, {...prev.maids[target], poster: url})}));
            showToast(isEnglish ? 'Poster uploaded.' : '海报已上传。', 'success');
        } catch (e: any) {
            // Nothing to roll back — the draft never held the preview.
            showToast(e?.message ?? (isEnglish ? 'Poster upload failed.' : '海报上传失败。'), 'error');
        } finally {
            // Safe now: the <img> swaps to the stored URL in the same commit.
            URL.revokeObjectURL(previewUrl);
            setPreview(null);
        }
    };

    const posterField = (target: PosterTarget, stored: string) => {
        if (readOnly) {
            return stored
                ?
                <img className="admin-cover-preview" src={stored} alt="" style={{aspectRatio: String(POSTER_ASPECT)}}/>
                : null;
        }
        return (
            <ImageUploadField
                variant="cover"
                preview={(preview?.target === target ? preview.url : stored) || null}
                onFileChange={(file, url) => uploadPoster(target, file, url)}
                onCleanupPreview={url => URL.revokeObjectURL(url)}
                cropAspect={POSTER_ASPECT}
                cropWidth={POSTER_WIDTH}
                showToast={showToast}
            />
        );
    };

    return (
        <SectionShell
            section="cafe"
            helper={{
                en: 'Posters are cropped to US Letter (8.5 × 11), the shape they are printed at, and open full size when clicked on the page. Leave both times blank until the hours are set.',
                zh: '海报按美式信纸（8.5 × 11）比例裁剪，即其印刷尺寸；在页面上点击即可查看大图。营业时间未定时，两个时间都留空即可。',
            }}
            editor={editor}
            busy={preview !== null}
            busyLabel={{en: 'Waiting for the poster upload...', zh: '正在等待海报上传...'}}
            readOnly={readOnly}
        >
            <div className="admin-con-cafe">
                <div className="admin-con-cafe-poster">
                    <span className="admin-con-cafe-label">
                        {isEnglish ? 'Café poster' : '咖啡厅海报'}
                        {preview?.target === 'cafe' && (
                            <span className="admin-con-dirty">{isEnglish ? 'Uploading...' : '上传中...'}</span>
                        )}
                    </span>
                    {posterField('cafe', draft.poster)}
                    {!readOnly && draft.poster && preview?.target !== 'cafe' && (
                        <button
                            type="button"
                            className="admin-btn admin-btn--link admin-con-cafe-clear"
                            onClick={() => setDraft(prev => ({...prev, poster: ''}))}
                        >
                            {isEnglish ? 'Remove poster' : '移除海报'}
                        </button>
                    )}
                </div>

                <div className="admin-form-grid">
                    <LocalizedField
                        label={{en: 'Theme', zh: '主题'}}
                        value={draft.theme}
                        onChange={next => setDraft(prev => ({...prev, theme: next}))}
                        readOnly={readOnly}
                    />
                    <LocalizedField
                        label={{en: 'Location', zh: '地点'}}
                        value={draft.location}
                        onChange={next => setDraft(prev => ({...prev, location: next}))}
                        readOnly={readOnly}
                    />
                    <label>
                        <span>{isEnglish ? 'Opens' : '开始营业'}</span>
                        <input
                            className="admin-input"
                            type="time"
                            value={draft.start}
                            onChange={e => !readOnly && setDraft(prev => ({...prev, start: e.target.value}))}
                            readOnly={readOnly}
                        />
                    </label>
                    <label>
                        <span>{isEnglish ? 'Closes' : '结束营业'}</span>
                        <input
                            className="admin-input"
                            type="time"
                            value={draft.end}
                            onChange={e => !readOnly && setDraft(prev => ({...prev, end: e.target.value}))}
                            readOnly={readOnly}
                        />
                    </label>
                    <LocalizedField
                        label={{en: 'Intro', zh: '介绍'}}
                        value={draft.intro}
                        onChange={next => setDraft(prev => ({...prev, intro: next}))}
                        readOnly={readOnly}
                        multiline
                    />
                </div>
            </div>

            <h4 className="admin-con-maids-title">{isEnglish ? 'Maids' : '女仆'}</h4>
            {draft.maids.length === 0 && (
                <EmptyRow label={{en: 'No maids announced yet.', zh: '暂未公布女仆。'}}/>
            )}

            <div className="admin-con-maids">
                {draft.maids.map((maid, index) => (
                    <div key={index} className="admin-con-card admin-con-maid">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {maid.name || (isEnglish ? `Maid ${index + 1}` : `女仆 ${index + 1}`)}
                                {preview?.target === index && (
                                    <span className="admin-con-dirty">
                                        {isEnglish ? 'Uploading...' : '上传中...'}
                                    </span>
                                )}
                            </span>
                            {/* The poster lands by position, so the line-up holds
                                still until it has. */}
                            <RowActions
                                index={index}
                                count={draft.maids.length}
                                onMove={delta => setDraft(prev => ({...prev, maids: moveAt(prev.maids, index, delta)}))}
                                onRemove={() => setDraft(prev => ({...prev, maids: removeAt(prev.maids, index)}))}
                                readOnly={readOnly}
                                disabled={preview !== null}
                                horizontal
                            />
                        </div>

                        <label>
                            <span>{isEnglish ? 'Name' : '名称'}</span>
                            <input
                                className="admin-input"
                                value={maid.name}
                                onChange={e => !readOnly && updateMaid(index, {...maid, name: e.target.value})}
                                readOnly={readOnly}
                            />
                        </label>

                        {posterField(index, maid.poster)}
                    </div>
                ))}
            </div>

            <AddButton
                label={{en: 'maid', zh: '女仆'}}
                onClick={() => setDraft(prev => ({...prev, maids: [...prev.maids, {name: '', poster: ''}]}))}
                readOnly={readOnly}
            />
        </SectionShell>
    );
};
