import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';

export function CopyButton({value}: {value: string}) {
    const {isEnglish} = useLanguage();
    const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

    useEffect(() => {
        if (state === 'idle') return;
        const timer = setTimeout(() => setState('idle'), 2000);
        return () => clearTimeout(timer);
    }, [state]);

    const copy = () => navigator.clipboard.writeText(value).then(() => setState('copied'), () => setState('failed'));

    return (
        <button
            type="button"
            className={`admin-btn admin-btn--purple${state === 'copied' ? ' admin-btn--copied' : ''}`}
            onClick={() => void copy()}
        >
            {state === 'copied'
                ? (isEnglish ? 'Copied ✓' : '已复制 ✓')
                : state === 'failed'
                    ? (isEnglish ? 'Copy failed' : '复制失败')
                    : (isEnglish ? 'Copy' : '复制')}
        </button>
    );
}

export function CopyField({value}: {value: string}) {
    return (
        <div className="admin-code-url">
            <input readOnly value={value} onClick={e => e.currentTarget.select()} className="admin-code-input"/>
            <CopyButton value={value}/>
        </div>
    );
}
