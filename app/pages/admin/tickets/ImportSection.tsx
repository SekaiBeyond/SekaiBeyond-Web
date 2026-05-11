import { type ChangeEvent, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, functionsErrorCode } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { EMAIL_RE } from './helpers';
import type { AttendeeData, ParsedRow, ParseError, TicketType } from './types';

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
    const [timestampCol, setTimestampCol] = useState<string>('');
    const [rowActions, setRowActions] = useState<Record<string, 'skip' | 'override' | 'add'>>({});

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
        setTimestampCol('');
        setRowActions({});
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const parseImportDate = (dStr: string): string | undefined => {
        if (!dStr) return undefined;
        let s = dStr.trim();
        const isoDate = new Date(s);
        if (!isNaN(isoDate.getTime()) && !s.includes('上午') && !s.includes('下午')) {
            return isoDate.toISOString();
        }
        s = s.replace(/-/g, '/');
        let isPM = false;
        let isAM = false;
        if (s.includes('下午')) {
            isPM = true;
            s = s.replace('下午', '').trim();
        } else if (s.includes('上午')) {
            isAM = true;
            s = s.replace('上午', '').trim();
        }
        if (s.match(/pm$/i)) {
            isPM = true;
            s = s.replace(/pm$/i, '').trim();
        }
        if (s.match(/am$/i)) {
            isAM = true;
            s = s.replace(/am$/i, '').trim();
        }
        const d = new Date(s);
        if (isNaN(d.getTime())) return undefined;
        if (isPM && d.getHours() < 12) d.setHours(d.getHours() + 12);
        else if (isAM && d.getHours() === 12) d.setHours(0);
        return d.toISOString();
    };

    const validateRows = (emailKey: string, nameKey: string, countKey: string, typeKey: string, timestampKey: string, records: Record<string, string>[]) => {
        const existingEmails = new Map(existingAttendees?.map(a => [a.email.toLowerCase(), {
            name: a.name,
            ticketCount: a.ticketCount,
            type: a.tickets[0]?.type || 'normal',
        }]) || []);
        const parsedRows: ParsedRow[] = [];
        const errs: ParseError[] = [];
        const seen = new Map<string, number>();

        if (!emailKey || !nameKey) {
            return {
                rows: [],
                errors: [{
                    row: 0,
                    message: isEnglish
                        ? 'Please select columns for Email and Name.'
                        : '请选择用于邮箱和姓名的列。',
                }],
            };
        }

        records.forEach((row, i) => {
            const rowNum = i + 2;
            const email = (row[emailKey] ?? '').trim().toLowerCase();
            const name = (row[nameKey] ?? '').trim();
            const countRaw = countKey ? (row[countKey] ?? '').trim() : '';
            const typeRaw = (typeKey ? (row[typeKey] ?? '').trim().toLowerCase() : 'normal');
            const timestampRaw = (timestampKey ? (row[timestampKey] ?? '').trim() : '');

            if (!email && !name && !countRaw && !timestampRaw) return;

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
            let count = 1;
            if (countRaw) {
                count = parseInt(countRaw, 10);
                if (!Number.isInteger(count) || count < 1 || count > 50) {
                    errs.push({
                        row: rowNum,
                        message: isEnglish
                            ? `ticketCount must be 1–50 (got "${countRaw}").`
                            : `门票数量需为 1–50（当前为"${countRaw}"）。`,
                    });
                    return;
                }
            }

            let type: TicketType = 'normal';
            if (typeRaw === 'early-bird' || typeRaw === 'earlybird') type = 'early-bird';
            else if (typeRaw === 'vip') type = 'vip';
            else if (typeRaw === 'comp ticket' || typeRaw === 'comp' || typeRaw === '赠票') type = 'Comp Ticket';
            else if (typeRaw === 'guest' || typeRaw === '嘉宾') type = 'guest';

            const timestamp = timestampRaw ? parseImportDate(timestampRaw) : undefined;
            if (timestampRaw && !timestamp) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? `Invalid timestamp: "${timestampRaw}"` : `时间戳无效："${timestampRaw}"`,
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
            const existing = existingEmails.get(email);
            parsedRows.push({
                email,
                name,
                ticketCount: count,
                type,
                timestamp,
                existingName: existing?.name,
                existingTicketCount: existing?.ticketCount,
                existingType: existing?.type,
                action: existing ? 'skip' : 'add'
            });
        });

        const deduped = new Map<string, ParsedRow>();
        for (const r of parsedRows) deduped.set(r.email, r);

        // Priority: existing rows with field differences first (need admin decision),
        // then new adds, then existing rows that are identical (no-op).
        const rank = (r: ParsedRow): number => {
            if (r.action === 'add') return 1;
            const hasDiff =
                (r.existingName !== undefined && r.existingName !== r.name) ||
                (r.existingTicketCount !== undefined && r.existingTicketCount !== r.ticketCount) ||
                (r.existingType !== undefined && r.existingType !== r.type);
            return hasDiff ? 0 : 2;
        };
        const finalRows = Array.from(deduped.values()).sort((a, b) => rank(a) - rank(b));

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
        const tsCol = fieldName(fields, 'timestamp', 'date', 'created at', 'created_at', 'time');

        setEmailCol(eCol);
        setNameCol(nCol);
        setCountCol(cCol);
        setTypeCol(tCol);
        setTimestampCol(tsCol);

        const {rows: finalRows, errors: errs} = validateRows(eCol, nCol, cCol, tCol, tsCol, records);
        setRows(finalRows);
        setErrors(errs);
    };

    const handleMappingChange = (type: 'email' | 'name' | 'count' | 'type' | 'timestamp', val: string) => {
        let e = emailCol;
        let n = nameCol;
        let c = countCol;
        let t = typeCol;
        let ts = timestampCol;
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
        if (type === 'timestamp') {
            setTimestampCol(val);
            ts = val;
        }

        const {rows: finalRows, errors: errs} = validateRows(e, n, c, t, ts, rawRecords);
        setRows(finalRows);
        setErrors(errs);
    };

    const parseFile = async (file: File) => {
        const XLSX = await import('xlsx/dist/xlsx.mini.min.js');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, {type: 'array', cellDates: true});
        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            return {
                fields: [] as string[],
                records: [] as Record<string, string>[],
            };
        }

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

        if (data.length === 0) {
            return {
                fields: [] as string[],
                records: [] as Record<string, string>[],
            };
        }

        const fields = Object.keys(data[0]);
        const records = data.map((row: Record<string, unknown>) => {
            const rec: Record<string, string> = {};
            fields.forEach(field => {
                const v = row[field];
                let str: string;
                if (v == null) {
                    str = '';
                } else if (v instanceof Date) {
                    str = v.toISOString();
                } else {
                    str = String(v);
                }
                rec[field] = str;
            });
            return rec;
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
            if (ext === 'xls') {
                setErrors([{
                    row: 0,
                    message: isEnglish
                        ? 'Legacy .xls files are not supported. Please re-save as .xlsx or export as .csv.'
                        : '不支持旧版 .xls 文件。请另存为 .xlsx 或导出为 .csv。',
                }]);
                return;
            }
            const {fields, records} = await parseFile(file);
            processFile(fields, records);
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
            action: r.action === 'add' ? (rowActions[r.email] || 'add') : (rowActions[r.email] || 'skip')
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
            const {added, replaced, skipped} = result.data;
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

    const canImport = !readOnly && !importing && rows.length > 0 && errors.filter(e => e.row === 0).length === 0 && !!emailCol && !!nameCol;

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
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFile}
                    disabled={readOnly || busy}
                />
                {fileName && <span className="admin-tickets-import-filename">{fileName}</span>}
            </div>

            {rawFields.length > 0 && (
                <div style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div className="admin-tickets-import-mapping"
                         style={{display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
                        <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            flex: '1 1 160px',
                            minWidth: 0
                        }}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Email Column:' : '邮箱列：'}</span>
                            <select value={emailCol} onChange={e => handleMappingChange('email', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)',
                                width: '100%',
                                textOverflow: 'ellipsis'
                            }}>
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            flex: '1 1 160px',
                            minWidth: 0
                        }}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Name Column:' : '姓名列：'}</span>
                            <select value={nameCol} onChange={e => handleMappingChange('name', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)',
                                width: '100%',
                                textOverflow: 'ellipsis'
                            }}>
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            flex: '1 1 160px',
                            minWidth: 0
                        }}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Tickets Column:' : '门票数量列：'}</span>
                            <select value={countCol} onChange={e => handleMappingChange('count', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)',
                                width: '100%',
                                textOverflow: 'ellipsis'
                            }}>
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            flex: '1 1 160px',
                            minWidth: 0
                        }}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Type Column:' : '门票类型列：'}</span>
                            <select value={typeCol} onChange={e => handleMappingChange('type', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)',
                                width: '100%',
                                textOverflow: 'ellipsis'
                            }}>
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            flex: '1 1 160px',
                            minWidth: 0
                        }}>
                            <span style={{
                                fontWeight: 500,
                                fontSize: '13px'
                            }}>{isEnglish ? 'Timestamp Column:' : '时间戳列：'}</span>
                            <select value={timestampCol}
                                    onChange={e => handleMappingChange('timestamp', e.target.value)}
                                    disabled={readOnly || busy} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #ccc)',
                                width: '100%',
                                textOverflow: 'ellipsis'
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
                                    {timestampCol && <th>{isEnglish ? 'Time' : '时间'}</th>}
                                    <th>{isEnglish ? 'Action' : '操作'}</th>
                                </tr>
                                </thead>
                                <tbody>
                                {rows.slice(0, MAX_PREVIEW).map((r, i) => {
                                    const nameChanged = r.existingName !== undefined && r.existingName !== r.name;
                                    const countChanged = r.existingTicketCount !== undefined && r.existingTicketCount !== r.ticketCount;
                                    const typeChanged = r.existingType !== undefined && r.existingType !== r.type;
                                    const isNew = r.action === 'add';
                                    const isChanged = !isNew && (nameChanged || countChanged || typeChanged);
                                    const rowClass = isChanged
                                        ? 'admin-tickets-import-row-changed'
                                        : isNew
                                            ? 'admin-tickets-import-row-new'
                                            : 'admin-tickets-import-row-unchanged';
                                    return (
                                        <tr key={`${r.email}-${i}`} className={rowClass}>
                                            <td>{i + 1}</td>
                                            <td>{r.email}</td>
                                            <td className={nameChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                                {nameChanged ? (
                                                    <>
                                                        <span
                                                            className="admin-tickets-import-diff-old">{r.existingName}</span>
                                                        <span className="admin-tickets-import-diff-new">{r.name}</span>
                                                    </>
                                                ) : r.name}
                                            </td>
                                            <td className={countChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                                {countChanged ? (
                                                    <>
                                                        <span
                                                            className="admin-tickets-import-diff-old">{r.existingTicketCount}</span>
                                                        <span
                                                            className="admin-tickets-import-diff-new">{r.ticketCount}</span>
                                                    </>
                                                ) : r.ticketCount}
                                            </td>
                                            <td className={typeChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                                {typeChanged ? (
                                                    <>
                                                        <span
                                                            className="admin-tickets-import-diff-old">{r.existingType}</span>
                                                        <span className="admin-tickets-import-diff-new">{r.type}</span>
                                                    </>
                                                ) : r.type}
                                            </td>
                                            {timestampCol && (
                                                <td>{r.timestamp ? new Date(r.timestamp).toLocaleString(isEnglish ? 'en-US' : 'zh-CN') : '-'}</td>
                                            )}
                                            <td>
                                                {isNew ? (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <span className="admin-tickets-import-row-badge is-new"
                                                              style={{minWidth: '85px', textAlign: 'center'}}>
                                                            {isEnglish ? 'Add New' : '新增'}
                                                        </span>
                                                        <select
                                                            value={rowActions[r.email] || 'add'}
                                                            onChange={e => setRowActions(prev => ({
                                                                ...prev,
                                                                [r.email]: e.target.value as 'skip' | 'add'
                                                            }))}
                                                            disabled={readOnly || busy}
                                                            style={{
                                                                padding: '2px 4px',
                                                                borderRadius: '4px',
                                                                border: '1px solid var(--border-color, #ccc)',
                                                                width: '90px'
                                                            }}
                                                        >
                                                            <option value="add">{isEnglish ? 'Add' : '添加'}</option>
                                                            <option value="skip">{isEnglish ? 'Skip' : '跳过'}</option>
                                                        </select>
                                                    </div>
                                                ) : (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <span
                                                            className={`admin-tickets-import-row-badge ${isChanged ? 'is-changed' : 'is-same'}`}
                                                            style={{minWidth: '85px', textAlign: 'center'}}>
                                                            {isChanged
                                                                ? (isEnglish ? 'Changed' : '有变更')
                                                                : (isEnglish ? 'No Change' : '无变更')}
                                                        </span>
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
                                                                border: '1px solid var(--border-color, #ccc)',
                                                                width: '90px'
                                                            }}
                                                        >
                                                            <option value="skip">{isEnglish ? 'Skip' : '跳过'}</option>
                                                            <option
                                                                value="override">{isEnglish ? 'Override' : '覆盖'}</option>
                                                        </select>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
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
