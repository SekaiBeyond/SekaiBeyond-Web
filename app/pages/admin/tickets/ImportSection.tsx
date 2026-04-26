import { type ChangeEvent, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { EMAIL_RE } from './helpers';
import type { ParsedRow, ParseError } from './types';

const MAX_PREVIEW = 50;
const MAX_IMPORT_ROWS = 1000;

interface ImportSectionProps {
    eventId: string;
    readOnly: boolean;
    showToast: ShowToast;
    onImported: () => void;
}

export function ImportSection({eventId, readOnly, showToast, onImported}: ImportSectionProps) {
    const {isEnglish} = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [fileName, setFileName] = useState<string>('');
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);

    const validateRows = (fields: string[], records: Record<string, string>[]) => {
        const parsedRows: ParsedRow[] = [];
        const errs: ParseError[] = [];
        const seen = new Map<string, number>();

        const fieldName = (keys: string[], ...candidates: string[]) => {
            const lower = keys.map(k => k.toLowerCase().trim());
            for (const c of candidates) {
                const idx = lower.indexOf(c);
                if (idx >= 0) return keys[idx];
            }
            return null;
        };

        const emailKey = fieldName(fields, 'email', 'e-mail');
        const nameKey = fieldName(fields, 'name', 'full name', 'display name');
        const countKey = fieldName(fields, 'ticketcount', 'ticket count',
            'ticket_count', 'tickets', 'quantity', 'count');

        if (!emailKey || !nameKey || !countKey) {
            return {
                rows: [],
                errors: [{
                    row: 0,
                    message: isEnglish
                        ? 'File must have columns: email, name, ticketCount (or "tickets").'
                        : '文件需要包含列：email、name、ticketCount（或"tickets"）。',
                }],
            };
        }

        records.forEach((row, i) => {
            const rowNum = i + 2;
            const email = (row[emailKey] ?? '').trim().toLowerCase();
            const name = (row[nameKey] ?? '').trim();
            const countRaw = (row[countKey] ?? '').trim();

            if (!email && !name && !countRaw) return;

            if (!EMAIL_RE.test(email)) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? `Invalid email: "${email}"` : `邮箱无效："${email}"`,
                });
                return;
            }
            if (!name) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? 'Name is empty.' : '姓名为空。',
                });
                return;
            }
            if (name.length > 100) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? 'Name exceeds 100 characters.' : '姓名超过 100 字符。',
                });
                return;
            }
            const count = parseInt(countRaw, 10);
            if (!Number.isInteger(count) || count < 1 || count > 50) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `ticketCount must be 1–50 (got "${countRaw}").`
                        : `门票数量需为 1–50（当前为"${countRaw}"）。`,
                });
                return;
            }
            if (seen.has(email)) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `Duplicate email "${email}" — later row will win.`
                        : `邮箱"${email}"重复，将以后一行为准。`,
                });
            }
            seen.set(email, parsedRows.length);
            parsedRows.push({email, name, ticketCount: count});
        });

        const deduped = new Map<string, ParsedRow>();
        for (const r of parsedRows) deduped.set(r.email, r);
        const finalRows = Array.from(deduped.values());

        if (finalRows.length > MAX_IMPORT_ROWS) {
            errs.push({
                row: 0,
                message: isEnglish
                    ? `Too many rows (${finalRows.length}). Max ${MAX_IMPORT_ROWS}.`
                    : `行数过多（${finalRows.length}）。最多 ${MAX_IMPORT_ROWS}。`,
            });
        }

        return {rows: finalRows, errors: errs};
    };

    const parseExcel = async (file: File) => {
        const ExcelJS = (await import('exceljs')).default;
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) {
            return {
                fields: [] as string[],
                records: [] as Record<string, string>[],
            };
        }
        const headerRow = sheet.getRow(1);
        const fields: string[] = [];
        headerRow.eachCell({includeEmpty: false}, (cell) => {
            fields.push(String(cell.value ?? '').trim());
        });
        const records: Record<string, string>[] = [];
        sheet.eachRow({includeEmpty: false}, (row, rowIdx) => {
            if (rowIdx === 1) return;
            const rec: Record<string, string> = {};
            fields.forEach((field, i) => {
                const cell = row.getCell(i + 1);
                const v = cell.value;
                let str = '';
                if (v == null) str = '';
                else if (typeof v === 'object' && 'text' in v && typeof (v as {text: unknown}).text === 'string') {
                    str = (v as {text: string}).text;
                } else if (typeof v === 'object' && 'result' in v) {
                    str = String((v as {result: unknown}).result ?? '');
                } else if (v instanceof Date) {
                    str = v.toISOString();
                } else {
                    str = String(v);
                }
                rec[field] = str;
            });
            records.push(rec);
        });
        return {fields, records};
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setFileName(file.name);
        setRows([]);
        setErrors([]);
        try {
            const ext = file.name.toLowerCase().split('.').pop() ?? '';
            const isExcel = ext === 'xlsx' || ext === 'xls' ||
                file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                file.type === 'application/vnd.ms-excel';

            if (isExcel) {
                try {
                    const {fields, records} = await parseExcel(file);
                    const {rows: finalRows, errors: errs} = validateRows(fields, records);
                    setRows(finalRows);
                    setErrors(errs);
                } catch (err) {
                    console.error('[import] excel parse error', err);
                    setErrors([{
                        row: 0,
                        message: isEnglish ? 'Failed to parse Excel file.' : '解析 Excel 文件失败。',
                    }]);
                }
            } else {
                const Papa = (await import('papaparse')).default;
                await new Promise<void>((resolve) => {
                    Papa.parse<Record<string, string>>(file, {
                        header: true,
                        skipEmptyLines: 'greedy',
                        complete: (res) => {
                            const fields = res.meta.fields ?? [];
                            const {rows: finalRows, errors: errs} = validateRows(fields, res.data);
                            setRows(finalRows);
                            setErrors(errs);
                            resolve();
                        },
                        error: (err: Error) => {
                            setErrors([{row: 0, message: err.message}]);
                            resolve();
                        },
                    });
                });
            }
        } catch (err) {
            console.error('[import] parse error', err);
            setErrors([{
                row: 0,
                message: isEnglish ? 'Failed to parse file.' : '解析文件失败。',
            }]);
        } finally {
            setBusy(false);
        }
    };

    const confirmImport = async () => {
        if (readOnly) return;
        if (rows.length === 0) return;
        const ok = window.confirm(isEnglish
            ? `Import ${rows.length} attendees? Existing emails will have their tickets re-issued.`
            : `导入 ${rows.length} 位参加者？已存在的邮箱将重新签发门票。`);
        if (!ok) return;
        setImporting(true);
        try {
            const result = await callImportEventAttendees({eventId, attendees: rows});
            const {added, replaced, total} = result.data;
            showToast(
                isEnglish
                    ? `Imported ${total}: ${added} new, ${replaced} replaced.`
                    : `已导入 ${total} 位：新增 ${added}，替换 ${replaced}。`,
                'success',
            );
            setRows([]);
            setErrors([]);
            setFileName('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            onImported();
        } catch (err) {
            const code = functionsErrorCode(err);
            let msg: string;
            if (code === 'has-staff') {
                const details = functionsErrorDetails<{emails?: string[]}>(err);
                const emails = details?.emails ?? [];
                const list = emails.slice(0, 5).join(', ') + (emails.length > 5 ? `, +${emails.length - 5}` : '');
                msg = isEnglish
                    ? `Import blocked: ${emails.length} email(s) are event staff for this event and cannot be attendees: ${list}. Remove them as staff first or omit them from the import.`
                    : `导入被阻止：${emails.length} 个邮箱是该活动的工作人员，不能同时作为参加者：${list}。请先撤销其工作人员身份，或从导入中移除这些邮箱。`;
            } else {
                msg = isEnglish
                    ? `Import failed${code ? ` (${code})` : ''}.`
                    : `导入失败${code ? `（${code}）` : ''}。`;
            }
            showToast(msg, 'error');
        } finally {
            setImporting(false);
        }
    };

    const canImport = !readOnly && !importing && rows.length > 0 && errors.filter(e => e.row === 0).length === 0;

    return (
        <div className="admin-tickets-import">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Upload a CSV or Excel file with columns: email, name, ticketCount (or "tickets"). Re-importing an existing email re-issues their tickets.'
                    : '上传 CSV 或 Excel 文件，需包含列：email、name、ticketCount（或"tickets"）。重复导入相同邮箱会重新签发该人的门票。'}
            </p>
            <div className="admin-tickets-import-file-row">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleFile}
                    disabled={readOnly || busy}
                />
                {fileName && <span className="admin-tickets-import-filename">{fileName}</span>}
            </div>

            {errors.length > 0 && (
                <div className="admin-tickets-import-errors">
                    <strong>{isEnglish ? 'Issues' : '问题'}</strong>
                    <ul>
                        {errors.slice(0, 20).map((e, i) => (
                            <li key={i}>
                                {e.row > 0 && (
                                    <span className="admin-tickets-import-rownum">
                                        {isEnglish ? `Row ${e.row}:` : `第 ${e.row} 行：`}
                                    </span>
                                )}{' '}
                                {e.message}
                            </li>
                        ))}
                        {errors.length > 20 && (
                            <li>
                                {isEnglish
                                    ? `…and ${errors.length - 20} more.`
                                    : `…还有 ${errors.length - 20} 条。`}
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <div className="admin-tickets-import-preview">
                        <div className="admin-tickets-import-preview-header">
                            <strong>
                                {isEnglish
                                    ? `Preview (${rows.length} row${rows.length === 1 ? '' : 's'})`
                                    : `预览（${rows.length} 行）`}
                            </strong>
                            {rows.length > MAX_PREVIEW && (
                                <span className="admin-helper-text">
                                    {isEnglish
                                        ? `Showing first ${MAX_PREVIEW}.`
                                        : `仅显示前 ${MAX_PREVIEW} 行。`}
                                </span>
                            )}
                        </div>
                        <table className="admin-tickets-table">
                            <thead>
                            <tr>
                                <th>#</th>
                                <th>{isEnglish ? 'Email' : '邮箱'}</th>
                                <th>{isEnglish ? 'Name' : '姓名'}</th>
                                <th>{isEnglish ? 'Tickets' : '门票数'}</th>
                            </tr>
                            </thead>
                            <tbody>
                            {rows.slice(0, MAX_PREVIEW).map((r, i) => (
                                <tr key={`${r.email}-${i}`}>
                                    <td>{i + 1}</td>
                                    <td>{r.email}</td>
                                    <td>{r.name}</td>
                                    <td>{r.ticketCount}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={confirmImport}
                            disabled={!canImport}
                        >
                            {importing
                                ? (isEnglish ? 'Importing...' : '导入中...')
                                : (isEnglish ? 'Confirm Import' : '确认导入')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                setRows([]);
                                setErrors([]);
                                setFileName('');
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            disabled={importing}
                        >
                            {isEnglish ? 'Clear' : '清空'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
