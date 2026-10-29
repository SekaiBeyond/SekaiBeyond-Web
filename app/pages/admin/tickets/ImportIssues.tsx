import { useLanguage } from '~/components/LanguageContextProvider';
import type { ParseError } from './types';

/** Issues listed before the rest are summed up. */
const MAX_ISSUES = 20;

/** What reading an import file turned up, by row where it has one. */
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
