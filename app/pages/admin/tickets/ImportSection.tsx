import { type ChangeEvent, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, functionsErrorCode } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { EMAIL_RE } from './helpers';
import type { AttendeeData, ParsedRow, ParseError } from './types';

const MAX_PREVIEW = 50;
const MAX_IMPORT_ROWS = 1000;

interface ImportSectionProps {
    eventId: string;
    existingAttendees?: AttendeeData[];
    readOnly: boolean;
    showToast: ShowToast;
    onImported: () => void;
}

export function ImportSection({eventId, existingAttendees, readOnly, showToast, onImported}: ImportSectionProps) {
    const {isEnglish} = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [fileName, setFileName] = useState<string>('');
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);

    const [rawFields, setRawFields] = useState<string[]>([]);
    const [rawRecords, setRawRecords] = useState<Record<string, string>[]>([]);
    const [emailCol, setEmailCol] = useState<string>('');
    const [nameCol, setNameCol] = useState<string>('');
    const [countCol, setCountCol] = useState<string>('');
    const [typeCol, setTypeCol] = useState<string>('');
    const [rowActions, setRowActions] = useState<Record<string, 'skip' | 'override'>>({});

    const clearForm = () => {
        setRows([]);
        setErrors([]);
        setFileName('');
        setRawFields([]);
        setRawRecords([]);
        setEmailCol('');
        setNameCol('');
        setCountCol('');
        setTypeCol('');
        setRowActions({});
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const validateRows = (emailKey: string, nameKey: string, countKey: string, typeKey: string, records: Record<string, string>[]) => {
        const existingEmails = new Map(existingAttendees?.map(a => [a.email.toLowerCase(), {
            name: a.name,
            ticketCount: a.ticketCount,
            type: a.tickets[0]?.type || 'normal',
        }]) || []);
        const parsedRows: ParsedRow[] = [];
        const errs: ParseError[] = [];
        const seen = new Map<string, number>();

        if (!emailKey || !nameKey || !countKey) {
            return {
                rows: [],
                errors: [{
                    row: 0,
                    message: isEnglish
                        ? 'Please select columns for Email, Name, and Ticket Count.'
                        : '请选择用于邮箱、姓名和门票数量的列。',
                }],
            };
        }

        records.forEach((row, i) => {
            const rowNum = i + 2;
            const email = (row[emailKey] ?? '').trim().toLowerCase();
            const name = (row[nameKey] ?? '').trim();
            const countRaw = (row[countKey] ?? '').trim();
            const typeRaw = (typeKey ? (row[typeKey] ?? '').trim().toLowerCase() : 'normal');

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

            let type: TicketType = 'normal';
            if (typeRaw === 'early-bird' || typeRaw === 'earlybird') type = 'early-bird';
            else if (typeRaw === 'vip') type = 'vip';
            else if (typeRaw === 'comp ticket' || typeRaw === 'comp' || typeRaw === '赠票') type = 'Comp Ticket';
            else if (typeRaw === 'guest' || typeRaw === '嘉宾') type = 'guest';

            if (seen.has(email)) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `Duplicate email "${email}" — later row will win.`
                        : `邮箱"${email}"重复，将以后一行为准。`,
                });
            }
            seen.set(email, parsedRows.length);
            const existing = existingEmails.get(email);
            parsedRows.push({
                email,
                name,
                ticketCount: count,
                type,
                existingName: existing?.name,
                existingTicketCount: existing?.ticketCount,
                existingType: existing?.type,
                action: existing ? 'skip' : 'add'
            });
        });

        const deduped = new Map<string, ParsedRow>();
        for (const r of parsedRows) deduped.set(r.email, r);
        const finalRows = Array.from(deduped.values()).sort((a, b) => {
            if (a.action !== 'add' && b.action === 'add') return -1;
            if (a.action === 'add' && b.action !== 'add') return 1;
            return 0;
        });

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

    const processFile = (fields: string[], records: Record<string, string>[]) => {
        setRawFields(fields);
        setRawRecords(records);

        const fieldName = (keys: string[], ...candidates: string[]) => {
            const lower = keys.map(k => k.toLowerCase().trim());
            for (const c of candidates) {
                const idx = lower.indexOf(c);
                if (idx >= 0) return keys[idx];
            }
            return '';
        };

        const eCol = fieldName(fields, 'email', 'e-mail');
        const nCol = fieldName(fields, 'name', 'full name', 'display name');
        const cCol = fieldName(fields, 'ticketcount', 'ticket count',
            'ticket_count', 'tickets', 'quantity', 'count');
        const tCol = fieldName(fields, 'type', 'ticket type', 'ticket_type', 'category');

        setEmailCol(eCol);
        setNameCol(nCol);
        setCountCol(cCol);
        setTypeCol(tCol);

        const {rows: finalRows, errors: errs} = validateRows(eCol, nCol, cCol, tCol, records);
        setRows(finalRows);
        setErrors(errs);
    };

    const handleMappingChange = (type: 'email' | 'name' | 'count' | 'type', val: string) => {
        let e = emailCol;
        let n = nameCol;
        let c = countCol;
        let t = typeCol;
        if (type === 'email') {
            setEmailCol(val);
            e = val;
        }
        if (type === 'name') {
            setNameCol(val);
            n = val;
        }
        if (type === 'count') {
            setCountCol(val);
            c = val;
        }
        if (type === 'type') {
            setTypeCol(val);
            t = val;
        }

        const {rows: finalRows, errors: errs} = validateRows(e, n, c, t, rawRecords);
        setRows(finalRows);
        setErrors(errs);
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
                    processFile(fields, records);
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
                            processFile(fields, res.data);
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

        const finalSubmitRows = rows.map(r => ({
            ...r,
            action: r.action === 'add' ? 'add' : (rowActions[r.email] || 'skip')
        }));

        const toSend = finalSubmitRows.filter(r => r.action !== 'skip');
        const manuallySkipped = finalSubmitRows.filter(r => r.action === 'skip').length;

        if (toSend.length === 0) {
            showToast(isEnglish ? 'No attendees to import after skipping.' : '跳过后没有可导入的参加者。', 'warning');
            return;
        }

        const ok = window.confirm(isEnglish
            ? `Import ${toSend.length} attendees (${manuallySkipped} skipped)?`
            : `导入 ${toSend.length} 位参加者（跳过 ${manuallySkipped} 位）？`);
        if (!ok) return;

        setImporting(true);
        try {
            // We pass onDuplicate: 'override' because we've already filtered out the ones we want to skip locally.
            // Any existing ones remaining in 'toSend' are explicitly meant to be overridden.
            const result = await callImportEventAttendees({eventId, attendees: toSend, onDuplicate: 'override'});
            const {added, replaced, skipped, total} = result.data;
            const totalSkipped = skipped + manuallySkipped;
            showToast(
                isEnglish
                    ? `Imported: ${added} new, ${replaced} replaced, ${totalSkipped} skipped.`
                    : `共处理：新增 ${added}，替换 ${replaced}，跳过 ${totalSkipped}。`,
                'success',
            );
            clearForm();
            onImported();
        } catch (err) {
            const code = functionsErrorCode(err);
            let msg: string;
            msg = isEnglish
                ? `Import failed${code ? ` (${code})` : ''}.`
                : `导入失败${code ? ` (${code})` : ''}。`;
            showToast(msg, 'error');
        } finally {
            setImporting(false);
        }
    };

    const canImport = !readOnly && !importing && rows.length > 0 && errors.filter(e => e.row === 0).length === 0 && !!emailCol && !!nameCol && !!countCol;

    return (
        <div className="admin-tickets-import">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Upload a CSV or Excel file to begin importing tickets. Existing emails will have their tickets re-issued.'
                    : '上传 CSV 或 Excel 文件开始导入门票。重复导入相同邮箱会重新签发该人的门票。'}
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

            {rawFields.length > 0 && (
                <div style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div className="admin-tickets-import-mapping"
                         style={{display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
                        <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Email Column:' : '邮箱列：'}</span>
                            <select value={emailCol} onChange={e => handleMappingChange('email', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)'
                            }}>
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Name Column:' : '姓名列：'}</span>
                            <select value={nameCol} onChange={e => handleMappingChange('name', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)'
                            }}>
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Tickets Column:' : '门票数量列：'}</span>
                            <select value={countCol} onChange={e => handleMappingChange('count', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)'
                            }}>
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Type Column:' : '门票类型列：'}</span>
                            <select value={typeCol} onChange={e => handleMappingChange('type', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)'
                            }}>
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                    </div>
                </div>
            )}

            {errors.length > 0 && (
                <div className="admin-tickets-import-errors" style={{marginTop: '1rem'}}>
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
                <div style={{marginTop: '1rem'}}>
                    <div className="admin-tickets-import-preview">
                        <div className="admin-tickets-import-preview-header">
                            <strong>
                                {isEnglish
                                    ? `Preview (${rows.length} row${rows.length === 1 ? '' : 's'})`
                                    : `预览（${rows.length} 行）`}
                            </strong>
                            {rows.length > MAX_PREVIEW && (
                                <span className="admin-helper-text" style={{marginLeft: '1rem'}}>
                                    {isEnglish
                                        ? `Showing first ${MAX_PREVIEW}.`
                                        : `仅显示前 ${MAX_PREVIEW} 行。`}
                                </span>
                            )}
                        </div>
                        <div className="admin-tickets-table-wrap">
                            <table className="admin-tickets-table">
                                <thead>
                                <tr>
                                    <th>#</th>
                                    <th>{isEnglish ? 'Email' : '邮箱'}</th>
                                    <th>{isEnglish ? 'Name' : '姓名'}</th>
                                    <th>{isEnglish ? 'Tickets' : '门票数'}</th>
                                    <th>{isEnglish ? 'Type' : '类型'}</th>
                                    <th>{isEnglish ? 'Action' : '操作'}</th>
                                </tr>
                                </thead>
                                <tbody>
                                {rows.slice(0, MAX_PREVIEW).map((r, i) => (
                                    <tr key={`${r.email}-${i}`}>
                                        <td>{i + 1}</td>
                                        <td>{r.email}</td>
                                        <td>
                                            {r.existingName !== undefined && r.existingName !== r.name ? (
                                                <>
                                                <span style={{
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-color-light, #888)',
                                                    marginRight: '6px'
                                                }}>{r.existingName}</span>
                                                    <span style={{
                                                        color: 'var(--success-color, #28a745)',
                                                        fontWeight: 'bold'
                                                    }}>{r.name}</span>
                                                </>
                                            ) : r.name}
                                        </td>
                                        <td>
                                            {r.existingTicketCount !== undefined && r.existingTicketCount !== r.ticketCount ? (
                                                <>
                                                <span style={{
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-color-light, #888)',
                                                    marginRight: '6px'
                                                }}>{r.existingTicketCount}</span>
                                                    <span style={{
                                                        color: 'var(--success-color, #28a745)',
                                                        fontWeight: 'bold'
                                                    }}>{r.ticketCount}</span>
                                                </>
                                            ) : r.ticketCount}
                                        </td>
                                        <td>
                                            {r.existingType !== undefined && r.existingType !== r.type ? (
                                                <>
                                                <span style={{
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-color-light, #888)',
                                                    marginRight: '6px'
                                                }}>{r.existingType}</span>
                                                    <span style={{
                                                        color: 'var(--success-color, #28a745)',
                                                        fontWeight: 'bold'
                                                    }}>{r.type}</span>
                                                </>
                                            ) : r.type}
                                        </td>
                                        <td>
                                            {r.action === 'add' ? (
                                                <span
                                                    style={{color: 'var(--success-color, #28a745)'}}>{isEnglish ? 'Add New' : '新增'}</span>
                                            ) : (
                                                <select
                                                    value={rowActions[r.email] || 'skip'}
                                                    onChange={e => setRowActions(prev => ({
                                                        ...prev,
                                                        [r.email]: e.target.value as 'skip' | 'override'
                                                    }))}
                                                    disabled={readOnly || busy}
                                                    style={{
                                                        padding: '2px 4px',
                                                        borderRadius: '4px',
                                                        border: '1px solid var(--border-color, #ccc)'
                                                    }}
                                                >
                                                    <option value="skip">{isEnglish ? 'Skip' : '跳过'}</option>
                                                    <option value="override">{isEnglish ? 'Override' : '覆盖'}</option>
                                                </select>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="admin-btn-row" style={{marginTop: '1rem'}}>
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
                            onClick={clearForm}
                            disabled={importing}
                        >
                            {isEnglish ? 'Clear' : '清空'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
