import type { Tag } from '~/lib/tags';

interface TagMultiSelectProps {
    tags: Tag[];
    selected: string[];
    onChange: (tagIds: string[]) => void;
    isEnglish: boolean;
}

// Toggle chips for an event's tags, under a div rather than a <label> so
// clicking the heading doesn't toggle the first chip.
export const TagMultiSelect = ({tags, selected, onChange, isEnglish}: TagMultiSelectProps) => {
    const toggle = (id: string) => {
        onChange(selected.includes(id)
            ? selected.filter(t => t !== id)
            : [...selected, id]);
    };

    return (
        <div className="admin-tag-field">
            <span>{isEnglish ? 'Tags' : '标签'}</span>
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
