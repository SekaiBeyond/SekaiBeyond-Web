import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportHometownTickets, callSetHometownAdmitUnlisted } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { type HometownTicketRow, hometownAttendeeId, parseHometownFile } from './hometown';
import { type AttendeeData, type ParseError, TICKET_TYPES, ticketTypeLabel } from './types';

/** Tickets per import call, well under the server's row cap. */
const IMPORT_CHUNK = 500;
/** Issues listed before the rest are summed up. */
const MAX_ISSUES = 20;

interface HometownSectionProps {
    eventId: string;
    attendees: AttendeeData[];
    /** Null while the setting loads. */
    admitUnlisted: boolean | null;
    onAdmitUnlistedChange: (enabled: boolean) => void;
    readOnly: boolean;
    showToast: ShowToast;
    onImported: () => void;
}

/**
 * Tickets sold through HomeTown, the school's box office: its guest list export
 * imported by ticket number, and whether a HomeTown ticket missing from it is
 * let in at the door.
 */
export function HometownSection({
                                    eventId,
                                    attendees,
                                    admitUnlisted,
                                    onAdmitUnlistedChange,
                                    readOnly,
                                    showToast,
                                    onImported,
                                }: HometownSectionProps) {
    const {isEnglish} = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState('');
    const [tickets, setTickets] = useState<HometownTicketRow[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [warnings, setWarnings] = useState<ParseError[]>([]);
    const [busy, setBusy] = useState(false);
    const [importing, setImporting] = useState(false);
    const [savingAdmit, setSavingAdmit] = useState(false);

    // What the import will do with each ticket, by the list as last loaded; the
    // server decides again from what's there when it runs.
    const preview = useMemo(() => {
        const byId = new Map(attendees.filter(a => a.hometown).map(a => [a.id, a]));
        let added = 0;
        let confirmed = 0;
        const types = new Map<string, number>();
        for (const t of tickets) {
            const existing = byId.get(hometownAttendeeId(t.ticketId));
            if (!existing) added++;
            else if (existing.unlisted) confirmed++;
            types.set(t.type, (types.get(t.type) ?? 0) + 1);
        }
        return {
            added,
            confirmed,
            already: tickets.length - added - confirmed,
            types: TICKET_TYPES.filter(tt => types.has(tt.value)).map(tt => [tt.value, types.get(tt.value)!] as const),
        };
    }, [attendees, tickets]);

    const clearForm = () => {
        setFileName('');
        setTickets([]);
        setErrors([]);
        setWarnings([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setFileName(file.name);
        setTickets([]);
        setErrors([]);
        setWarnings([]);
        try {
            const parsed = await parseHometownFile(file, isEnglish);
            setTickets(parsed.tickets);
            setErrors(parsed.errors);
            setWarnings(parsed.warnings);
        } catch (err) {
            console.error('[HometownSection] parse error', err);
            setErrors([{row: 0, message: isEnglish ? 'Failed to parse file.' : '解析文件失败。'}]);
        } finally {
            setBusy(false);
        }
    };

    const confirmImport = async () => {
        if (readOnly || tickets.length === 0) return;
        const ok = window.confirm(isEnglish
            ? `Import ${tickets.length} HomeTown tickets? Tickets already here are left as they are.`
            : `导入 ${tickets.length} 张 HomeTown 门票？已存在的门票保持不变。`);
        if (!ok) return;

        setImporting(true);
        const totals = {added: 0, confirmed: 0, skipped: 0};
        try {
            for (let i = 0; i < tickets.length; i += IMPORT_CHUNK) {
                const {data} = await callImportHometownTickets({
                    eventId,
                    tickets: tickets.slice(i, i + IMPORT_CHUNK),
                });
                totals.added += data.added;
                totals.confirmed += data.confirmed;
                totals.skipped += data.skipped;
            }
            showToast(isEnglish
                    ? `HomeTown import done: ${totals.added} added, ${totals.confirmed} unlisted tickets confirmed, ${totals.skipped} already here.`
                    : `HomeTown 导入完成：新增 ${totals.added}，确认未列入名单的门票 ${totals.confirmed}，已存在 ${totals.skipped}。`,
                'success');
            clearForm();
        } catch (err) {
            console.error('[HometownSection] import failed', err);
            // Earlier chunks may have landed; a re-import picks up where this stopped.
            showToast(isEnglish
                    ? 'HomeTown import failed partway. Import the same file again to finish it.'
                    : 'HomeTown 导入中途失败。请再次导入同一文件以完成。',
                'error');
        } finally {
            setImporting(false);
            onImported();
        }
    };

    const toggleAdmit = async (enabled: boolean) => {
        if (readOnly) return;
        if (enabled) {
            const ok = window.confirm(isEnglish
                ? 'Let in HomeTown tickets that aren\'t on the imported list? Each is recorded so it can\'t be used twice, but a fake ticket gets in the same way.'
                : '放行不在已导入名单中的 HomeTown 门票？每张都会被记录以防重复使用，但假票也会以同样方式入场。');
            if (!ok) return;
        }
        setSavingAdmit(true);
        try {
            await callSetHometownAdmitUnlisted({eventId, enabled});
            onAdmitUnlistedChange(enabled);
            showToast(enabled
                    ? (isEnglish ? 'Unlisted HomeTown tickets are now let in.' : '现已放行未列入名单的 HomeTown 门票。')
                    : (isEnglish ? 'HomeTown tickets must now be on the list.' : 'HomeTown 门票现须在名单中。'),
                enabled ? 'warning' : 'success');
        } catch {
            showToast(isEnglish ? 'Failed to change the setting.' : '更改设置失败。', 'error');
        } finally {
            setSavingAdmit(false);
        }
    };

    const issues = [...errors, ...warnings];
    const canImport = !readOnly && !busy && !importing && tickets.length > 0
        && !errors.some(e => e.row === 0);

    return (
        <div className="admin-tickets-import admin-tickets-hometown">
            <h3>{isEnglish ? 'HomeTown tickets' : 'HomeTown 门票'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Upload the guest list exported from HomeTown (Export Guest List). Each ticket is added once by its number and keeps it, so the QR on the HomeTown ticket scans here. Tickets already here are left as they are, so a newer export can be imported at any time, during the event too. HomeTown buyers aren\'t sent our ticket emails.'
                    : '上传从 HomeTown 导出的来宾名单（Export Guest List）。每张门票按门票号添加一次并沿用该号码，因此 HomeTown 门票上的二维码可在此扫描。已存在的门票保持不变，可随时（包括活动期间）导入更新的名单。HomeTown 购票者不会收到我们的门票邮件。'}
            </p>
            <div className="admin-tickets-import-file-row">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFile}
                    disabled={readOnly || busy || importing}
                />
                {fileName && <span className="admin-tickets-import-filename">{fileName}</span>}
            </div>

            {issues.length > 0 && (
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
            )}

            {tickets.length > 0 && (
                <>
                    <div className="admin-tickets-stats">
                        <span><strong>{tickets.length}</strong> {isEnglish ? 'in file' : '张在文件中'}</span>
                        <span><strong>{preview.added}</strong> {isEnglish ? 'new' : '新增'}</span>
                        <span><strong>{preview.already}</strong> {isEnglish ? 'already here' : '已存在'}</span>
                        {preview.confirmed > 0 && (
                            <span>
                                <strong>{preview.confirmed}</strong> {isEnglish ? 'let in unlisted, now confirmed' : '曾未列入名单放行，现确认'}
                            </span>
                        )}
                    </div>
                    <div className="admin-tickets-hometown-types">
                        {preview.types.map(([type, count]) => (
                            <span
                                key={type}
                                className={`admin-tickets-tag admin-tickets-tag-type-${type.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                                {ticketTypeLabel(type, isEnglish)} × {count}
                            </span>
                        ))}
                    </div>
                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => void confirmImport()}
                            disabled={!canImport}
                        >
                            {importing
                                ? (isEnglish ? 'Importing...' : '导入中...')
                                : (isEnglish ? 'Import HomeTown Tickets' : '导入 HomeTown 门票')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={clearForm}
                            disabled={importing}
                        >
                            {isEnglish ? 'Clear' : '清空'}
                        </button>
                    </div>
                </>
            )}

            <label className="admin-checkbox-label admin-tickets-hometown-admit">
                <input
                    type="checkbox"
                    checked={admitUnlisted === true}
                    onChange={(e) => void toggleAdmit(e.target.checked)}
                    disabled={readOnly || admitUnlisted === null || savingAdmit}
                />
                <span>
                    {isEnglish
                        ? 'Let in HomeTown tickets that aren\'t on the imported list'
                        : '放行不在已导入名单中的 HomeTown 门票'}
                </span>
            </label>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'For tickets bought after the last import. The scanner warns, lets them in and records the number, so the same ticket is refused if it\'s scanned again; a later import that lists it fills in the buyer. A fake ticket gets in the same way, so this is off unless turned on.'
                    : '用于上次导入后购买的门票。扫码时会提示并放行，同时记录门票号，同一张票再次扫描将被拒绝；之后的导入若包含此票，会补上购票者信息。假票也会以同样方式入场，因此默认关闭。'}
            </p>
        </div>
    );
}
