import { type ChangeEvent, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ParseError } from './types';

const MAX_ISSUES = 20;

export const SHEET_ACCEPT = '.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ImportIssues({issues}: {issues: ParseError[]}) {
    const {isEnglish} = useLanguage();
    if (issues.length === 0) return null;
    return (
        <div className="admin-tickets-import-errors">
            <strong>{isEnglish ? 'Issues' : '问题'}</strong>
            <ul>
                {issues.slice(0, MAX_ISSUES).map((e, i) => (
                    <li key={i}>
                        {e.row > 0 && (
                            <span className="admin-tickets-import-rownum">
                                {isEnglish ? `Row ${e.row}:` : `第 ${e.row} 行：`}
                            </span>
                        )}{' '}
                        {e.message}
                    </li>
                ))}
                {issues.length > MAX_ISSUES && (
                    <li>
                        {isEnglish
                            ? `…and ${issues.length - MAX_ISSUES} more.`
                            : `…还有 ${issues.length - MAX_ISSUES} 条。`}
                    </li>
                )}
            </ul>
        </div>
    );
}

export function useParsedSheet<T>(
    parse: (file: File, isEnglish: boolean) => Promise<{rows: T[]; errors: ParseError[]; warnings: ParseError[]}>,
    label: string,
) {
    const {isEnglish} = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const [rows, setRows] = useState<T[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [warnings, setWarnings] = useState<ParseError[]>([]);
    const [busy, setBusy] = useState(false);

    const reset = () => {
        setRows([]);
        setErrors([]);
        setWarnings([]);
    };

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        reset();
        try {
            const parsed = await parse(file, isEnglish);
            setRows(parsed.rows);
            setErrors(parsed.errors);
            setWarnings(parsed.warnings);
        } catch (err) {
            console.error(`[${label}] parse error`, err);
            setErrors([{row: 0, message: isEnglish ? 'Failed to parse file.' : '解析文件失败。'}]);
        } finally {
            setBusy(false);
        }
    };

    return {
        rows,
        errors,
        issues: [...errors, ...warnings],
        busy,
        clear: () => {
            reset();
            if (inputRef.current) inputRef.current.value = '';
        },
        input: (disabled: boolean) => (
            <div className="admin-tickets-import-file-row">
                <input ref={inputRef} type="file" accept={SHEET_ACCEPT} onChange={onFile} disabled={disabled}/>
            </div>
        ),
    };
}
