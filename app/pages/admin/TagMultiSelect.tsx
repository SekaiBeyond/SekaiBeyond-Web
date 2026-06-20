import type { Tag } from '~/lib/tags';

interface TagMultiSelectProps {
    tags: Tag[];
    selected: string[];
    onChange: (tagIds: string[]) => void;
    isEnglish: boolean;
    label?: string;
    labelCn?: string;
}

// Toggle-chip selector for assigning multiple tags to an event. Rendered as a
// div (not a <label>) so clicking the heading doesn't activate the first chip.
export const TagMultiSelect = ({
                                   tags,
                                   selected,
                                   onChange,
                                   isEnglish,
                                   label = 'Tags',
                                   labelCn = '标签',
                               }: TagMultiSelectProps) => {
    const toggle = (id: string) => {
        onChange(selected.includes(id)
            ? selected.filter(t => t !== id)
            : [...selected, id]);
    };

    return (
        <div className="admin-tag-field">
            <span>{isEnglish ? label : labelCn}</span>
            {tags.length === 0 ? (
                <p className="admin-tag-field-empty">
                    {isEnglish ? 'No tags available.' : '暂无可用标签。'}
                </p>
            ) : (
                <div className="admin-tag-chips">
                    {tags.map(t => {
                        const active = selected.includes(t.id);
                        return (
                            <button
                                type="button"
                                key={t.id}
                                className={`admin-tag-chip${active ? ' admin-tag-chip-active' : ''}`}
                                onClick={() => toggle(t.id)}
                                aria-pressed={active}
                            >
                                {isEnglish ? (t.name || t.nameCn) : (t.nameCn || t.name)}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
