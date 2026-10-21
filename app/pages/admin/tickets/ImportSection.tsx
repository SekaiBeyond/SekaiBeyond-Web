import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, functionsErrorCode } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import type { AttendeeData, ParsedRow, ParseError } from './types';
import { useAccountLinks } from './useAccountLinks';
import { type ColumnMapping, parseFile, validateRows } from './importValidation';
import { ImportPreviewTable, MAX_PREVIEW } from './ImportPreviewTable';

const MAPPING_LABEL_STYLE = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    flex: '1 1 160px',
    minWidth: 0,
};

const MAPPING_SPAN_STYLE = {
    fontWeight: 500,
    fontSize: '13px',
};

const MAPPING_SELECT_STYLE = {
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    width: '100%',
    textOverflow: 'ellipsis',
};

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
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);

    const previewEmails = useMemo(
        () => rows.slice(0, MAX_PREVIEW).map(r => r.email),
        [rows],
    );
    const {links: accountLinks} = useAccountLinks(eventId, previewEmails);

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
        const tsCol = fieldName(fields, 'timestamp', 'date', 'createdat', 'created at', 'created_at', 'time');

        setEmailCol(eCol);
        setNameCol(nCol);
        setCountCol(cCol);
        setTypeCol(tCol);
        setTimestampCol(tsCol);

        const {rows: finalRows, errors: errs} = validateRows(
            {email: eCol, name: nCol, count: cCol, type: tCol, timestamp: tsCol},
            records, existingAttendees, isEnglish,
        );
        setRows(finalRows);
        setErrors(errs);
    };

    const handleMappingChange = (type: keyof ColumnMapping, val: string) => {
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

        const {rows: finalRows, errors: errs} = validateRows(
            {email: e, name: n, count: c, type: t, timestamp: ts},
            rawRecords, existingAttendees, isEnglish,
        );
        setRows(finalRows);
        setErrors(errs);
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
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
            action: r.action === 'add' ? (rowActions[r.email] || 'add') : (rowActions[r.email] || 'skip'),
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
            // 'override': the duplicates to skip were filtered out locally, so any left are meant to be replaced.
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
            showToast(
                isEnglish
                    ? `Import failed${code ? ` (${code})` : ''}.`
                    : `导入失败${code ? ` (${code})` : ''}。`,
                'error',
            );
        } finally {
            setImporting(false);
        }
    };

    const canImport = !readOnly && !importing && rows.length > 0 && errors.filter(e => e.row === 0).length === 0 && !!emailCol;

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
            </div>

            {rawFields.length > 0 && (
                <div style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div className="admin-tickets-import-mapping"
                         style={{display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
                        <label style={MAPPING_LABEL_STYLE}>
                            <span style={MAPPING_SPAN_STYLE}>{isEnglish ? 'Email Column:' : '邮箱列：'}</span>
                            <select
                                value={emailCol}
                                onChange={e => handleMappingChange('email', e.target.value)}
                                disabled={readOnly || busy}
                                style={MAPPING_SELECT_STYLE}
                            >
                                <option value="">-- {isEnglish ? 'Select' : '选择'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={MAPPING_LABEL_STYLE}>
                            <span style={MAPPING_SPAN_STYLE}>{isEnglish ? 'Name Column:' : '姓名列：'}</span>
                            <select
                                value={nameCol}
                                onChange={e => handleMappingChange('name', e.target.value)}
                                disabled={readOnly || busy}
                                style={MAPPING_SELECT_STYLE}
                            >
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={MAPPING_LABEL_STYLE}>
                            <span style={MAPPING_SPAN_STYLE}>{isEnglish ? 'Tickets Column:' : '门票数量列：'}</span>
                            <select
                                value={countCol}
                                onChange={e => handleMappingChange('count', e.target.value)}
                                disabled={readOnly || busy}
                                style={MAPPING_SELECT_STYLE}
                            >
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={MAPPING_LABEL_STYLE}>
                            <span style={MAPPING_SPAN_STYLE}>{isEnglish ? 'Type Column:' : '门票类型列：'}</span>
                            <select
                                value={typeCol}
                                onChange={e => handleMappingChange('type', e.target.value)}
                                disabled={readOnly || busy}
                                style={MAPPING_SELECT_STYLE}
                            >
                                <option value="">-- {isEnglish ? 'Select (Optional)' : '选择（可选）'} --</option>
                                {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </label>
                        <label style={MAPPING_LABEL_STYLE}>
                            <span style={MAPPING_SPAN_STYLE}>{isEnglish ? 'Timestamp Column:' : '时间戳列：'}</span>
                            <select
                                value={timestampCol}
                                onChange={e => handleMappingChange('timestamp', e.target.value)}
                                disabled={readOnly || busy}
                                style={MAPPING_SELECT_STYLE}
                            >
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
                    <ImportPreviewTable
                        rows={rows}
                        accountLinks={accountLinks}
                        timestampCol={timestampCol}
                        rowActions={rowActions}
                        onRowActionChange={(email, act) => setRowActions(prev => ({...prev, [email]: act}))}
                        readOnly={readOnly}
                        busy={busy}
                    />
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
