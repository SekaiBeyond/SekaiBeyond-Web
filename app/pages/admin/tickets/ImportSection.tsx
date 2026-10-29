import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, errorSuffix } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import type { AttendeeData, ParsedRow, ParseError } from './types';
import { useAccountLinks } from './useAccountLinks';
import { type ColumnMapping, parseFile, validateRows } from './importValidation';
import { ImportIssues } from './ImportIssues';
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

const NO_MAPPING: ColumnMapping = {email: '', name: '', count: '', type: '', timestamp: ''};

/** Each column to pick, with the headers it's matched to on its own, lowercased. */
const MAPPING_FIELDS: {key: keyof ColumnMapping; en: string; zh: string; headers: string[]}[] = [
    {key: 'email', en: 'Email Column:', zh: '邮箱列：', headers: ['email', 'e-mail']},
    {key: 'name', en: 'Name Column:', zh: '姓名列：', headers: ['name', 'full name', 'display name']},
    {
        key: 'count', en: 'Tickets Column:', zh: '门票数量列：',
        headers: ['ticketcount', 'ticket count', 'ticket_count', 'tickets', 'quantity', 'count'],
    },
    {key: 'type', en: 'Type Column:', zh: '门票类型列：', headers: ['type', 'ticket type', 'ticket_type', 'category']},
    {
        key: 'timestamp', en: 'Timestamp Column:', zh: '时间戳列：',
        headers: ['timestamp', 'date', 'createdat', 'created at', 'created_at', 'time'],
    },
];

/** The first of `fields` to match one of `headers`, in the order they're listed. */
const guessColumn = (fields: string[], headers: string[]): string => {
    const lower = fields.map(f => f.toLowerCase().trim());
    for (const header of headers) {
        const idx = lower.indexOf(header);
        if (idx >= 0) return fields[idx];
    }
    return '';
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
    const [mapping, setMapping] = useState<ColumnMapping>(NO_MAPPING);
    const [rowActions, setRowActions] = useState<Record<string, 'skip' | 'override' | 'add'>>({});

    const clearForm = () => {
        setRows([]);
        setErrors([]);
        setRawFields([]);
        setRawRecords([]);
        setMapping(NO_MAPPING);
        setRowActions({});
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const applyMapping = (next: ColumnMapping, records: Record<string, string>[]) => {
        setMapping(next);
        const {rows: finalRows, errors: errs} = validateRows(next, records, existingAttendees, isEnglish);
        setRows(finalRows);
        setErrors(errs);
    };

    const processFile = (fields: string[], records: Record<string, string>[]) => {
        setRawFields(fields);
        setRawRecords(records);
        const guessed = {...NO_MAPPING};
        for (const field of MAPPING_FIELDS) guessed[field.key] = guessColumn(fields, field.headers);
        applyMapping(guessed, records);
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
            showToast(
                isEnglish
                    ? `Import failed${errorSuffix(err, true)}.`
                    : `导入失败${errorSuffix(err, false)}。`,
                'error',
            );
        } finally {
            setImporting(false);
        }
    };

    const canImport = !readOnly && !importing && rows.length > 0 && !errors.some(e => e.row === 0) && !!mapping.email;

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
                        {MAPPING_FIELDS.map(field => (
                            <label key={field.key} style={MAPPING_LABEL_STYLE}>
                                <span style={MAPPING_SPAN_STYLE}>{isEnglish ? field.en : field.zh}</span>
                                <select
                                    value={mapping[field.key]}
                                    onChange={e => applyMapping({...mapping, [field.key]: e.target.value}, rawRecords)}
                                    disabled={readOnly || busy}
                                    style={MAPPING_SELECT_STYLE}
                                >
                                    <option value="">
                                        -- {field.key === 'email'
                                        ? (isEnglish ? 'Select' : '选择')
                                        : (isEnglish ? 'Select (Optional)' : '选择（可选）')} --
                                    </option>
                                    {rawFields.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <ImportIssues issues={errors}/>

            {rows.length > 0 && (
                <div style={{marginTop: '1rem'}}>
                    <ImportPreviewTable
                        rows={rows}
                        accountLinks={accountLinks}
                        timestampCol={mapping.timestamp}
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
