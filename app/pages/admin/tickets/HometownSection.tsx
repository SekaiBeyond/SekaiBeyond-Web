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
    // Off after each import, since it flags whatever the file leaves out.
    const [updateExisting, setUpdateExisting] = useState(false);

    // What the import will do with each ticket, by the list as last loaded; the
    // server decides again from what's there when it runs.
    const preview = useMemo(() => {
        const hometown = attendees.filter(a => a.hometown);
        const byId = new Map(hometown.map(a => [a.id, a]));
        const inFile = new Set(tickets.map(t => t.ticketId));
        let added = 0;
        let confirmed = 0;
        let updated = 0;
        let restored = 0;
        const types = new Map<string, number>();
        for (const t of tickets) {
            const existing = byId.get(hometownAttendeeId(t.ticketId));
            if (!existing) added++;
            else if (existing.unlisted) confirmed++;
            else if (updateExisting) {
                if (existing.missingFromHometown) restored++;
                if (existing.name !== t.name || existing.email !== t.email
                    || existing.hometownOrderId !== t.orderId || (existing.tickets[0]?.type ?? 'normal') !== t.type) {
                    updated++;
                }
            }
            types.set(t.type, (types.get(t.type) ?? 0) + 1);
        }
        const listed = hometown.filter(a => !a.unlisted);
        return {
            added,
            confirmed,
            updated,
            restored,
            unchanged: tickets.length - added - confirmed - updated,
            listed: listed.length,
            missing: updateExisting ? listed.filter(a => !inFile.has(a.ticketIds[0] ?? '')).length : 0,
            types: TICKET_TYPES.filter(tt => types.has(tt.value)).map(tt => [tt.value, types.get(tt.value)!] as const),
        };
    }, [attendees, tickets, updateExisting]);

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
        const ok = window.confirm(updateExisting
            ? (isEnglish
                ? `Import ${tickets.length} HomeTown tickets and update the ones already here? About ${preview.updated} will be updated and ${preview.missing} not in this file will be flagged.`
                : `导入 ${tickets.length} 张 HomeTown 门票并更新已有门票？约 ${preview.updated} 张将被更新，${preview.missing} 张不在此文件中的门票将被标记。`)
            : (isEnglish
                ? `Import ${tickets.length} HomeTown tickets? Tickets already here are left as they are.`
                : `导入 ${tickets.length} 张 HomeTown 门票？已存在的门票保持不变。`));
        if (!ok) return;

        setImporting(true);
        const totals = {added: 0, confirmed: 0, updated: 0, skipped: 0, missing: 0, restored: 0};
        try {
            for (let i = 0; i < tickets.length; i += IMPORT_CHUNK) {
                const last = i + IMPORT_CHUNK >= tickets.length;
                const {data} = await callImportHometownTickets({
                    eventId,
                    tickets: tickets.slice(i, i + IMPORT_CHUNK),
                    // The whole file's numbers go with its last chunk, once the
                    // rest are in, so nothing it holds reads as missing.
                    ...(updateExisting && {
                        updateExisting: true,
                        ...(last && {completeTicketIds: tickets.map(t => t.ticketId)}),
                    }),
                });
                totals.added += data.added;
                totals.confirmed += data.confirmed;
                totals.updated += data.updated;
                totals.skipped += data.skipped;
                totals.restored += data.restored;
                totals.missing = data.missing;
            }
            const parts = isEnglish
                ? [
                    `${totals.added} added`,
                    totals.confirmed > 0 && `${totals.confirmed} unlisted tickets confirmed`,
                    updateExisting && `${totals.updated} updated`,
                    `${totals.skipped} ${updateExisting ? 'unchanged' : 'already here'}`,
                    totals.restored > 0 && `${totals.restored} back in the export`,
                    totals.missing > 0 && `${totals.missing} not in this file, flagged`,
                ]
                : [
                    `新增 ${totals.added}`,
                    totals.confirmed > 0 && `确认未列入名单的门票 ${totals.confirmed}`,
                    updateExisting && `更新 ${totals.updated}`,
                    `${updateExisting ? '未变' : '已存在'} ${totals.skipped}`,
                    totals.restored > 0 && `重新出现在导出中 ${totals.restored}`,
                    totals.missing > 0 && `不在此文件中并已标记 ${totals.missing}`,
                ];
            showToast(isEnglish
                    ? `HomeTown import done: ${parts.filter(Boolean).join(', ')}.`
                    : `HomeTown 导入完成：${parts.filter(Boolean).join('，')}。`,
                totals.missing > 0 ? 'warning' : 'success');
            clearForm();
            setUpdateExisting(false);
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

            <label className="admin-checkbox-label admin-tickets-hometown-update">
                <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    disabled={readOnly || importing}
                />
                <span>{isEnglish ? 'Update existing tickets from this file' : '用此文件更新已有门票'}</span>
            </label>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Takes this file as HomeTown\'s latest word, as for the final import after the event: changed names, emails, types and order numbers are copied onto tickets already here, replacing edits made here, while check-ins and voids are never touched. Tickets here that the file leaves out are flagged "Not in latest export" for you to review and void, so use the full Export Guest List.'
                    : '以此文件为 HomeTown 的最新数据，适用于活动结束后的最终导入：已有门票的姓名、邮箱、类型和订单号若有变化将被更新（覆盖在此所做的修改），签到和作废状态不受影响。文件中没有的已有门票将被标记为"不在最新导出中"，供你核查并作废，因此请使用完整的 Export Guest List。'}
            </p>

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
                        {updateExisting && (
                            <span><strong>{preview.updated}</strong> {isEnglish ? 'to update' : '将更新'}</span>
                        )}
                        <span>
                            <strong>{preview.unchanged}</strong> {updateExisting
                                ? (isEnglish ? 'unchanged' : '未变')
                                : (isEnglish ? 'already here' : '已存在')}
                        </span>
                        {preview.confirmed > 0 && (
                            <span>
                                <strong>{preview.confirmed}</strong> {isEnglish ? 'let in unlisted, now confirmed' : '曾未列入名单放行，现确认'}
                            </span>
                        )}
                        {preview.restored > 0 && (
                            <span><strong>{preview.restored}</strong> {isEnglish ? 'back in the export' : '重新出现在导出中'}</span>
                        )}
                        {preview.missing > 0 && (
                            <span><strong>{preview.missing}</strong> {isEnglish ? 'not in file, to flag' : '不在文件中，将标记'}</span>
                        )}
                    </div>
                    {preview.missing > 0 && (
                        <p className="admin-helper-text admin-tickets-edit-warning">
                            {isEnglish
                                ? `${preview.missing} of the ${preview.listed} HomeTown tickets here aren't in this file and will be flagged "Not in latest export". If this isn't HomeTown's full guest list export, untick "Update existing tickets".`
                                : `此处 ${preview.listed} 张 HomeTown 门票中有 ${preview.missing} 张不在此文件中，将被标记为"不在最新导出中"。如果这不是 HomeTown 完整的来宾名单导出，请取消勾选"用此文件更新已有门票"。`}
                        </p>
                    )}
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
