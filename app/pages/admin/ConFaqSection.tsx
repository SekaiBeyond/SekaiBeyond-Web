import { useLanguage } from '~/components/LanguageContextProvider';
import type { ConContent } from '~/lib/conContent';
import {
    AddButton,
    BLANK,
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

export const FaqSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('faq', content.faq, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['faq'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    return (
        <SectionShell
            section="faq"
            helper={{
                en: 'Questions appear in this order, collapsed until a visitor opens them.',
                zh: '问题按此顺序展示，默认折叠，访客点击后展开。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No questions yet.', zh: '暂无问题。'}}/>}

                {draft.map((entry, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {entry.q.en || (isEnglish ? `Question ${index + 1}` : `问题 ${index + 1}`)}
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
                                label={{en: 'Question', zh: '问题'}}
                                value={entry.q}
                                onChange={next => update(index, {...entry, q: next})}
                                readOnly={readOnly}
                            />
                            <LocalizedField
                                label={{en: 'Answer', zh: '回答'}}
                                value={entry.a}
                                onChange={next => update(index, {...entry, a: next})}
                                readOnly={readOnly}
                                multiline
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'question', zh: '问题'}}
                    onClick={() => setDraft(prev => [...prev, {q: BLANK, a: BLANK}])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};
