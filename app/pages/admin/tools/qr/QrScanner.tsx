import { type ChangeEvent, type ComponentType, useRef, useState } from 'react';
import {
    FiAlertCircle,
    FiCamera,
    FiCameraOff,
    FiCopy,
    FiExternalLink,
    FiFileText,
    FiImage,
    FiLink,
    FiMail,
    FiMap,
    FiMapPin,
    FiMessageSquare,
    FiPhone,
    FiRotateCcw,
    FiSquare,
    FiUser,
    FiWifi,
} from 'react-icons/fi';
import { useLanguage } from '~/components/LanguageContextProvider';
import { decodeQrImage, type QrCorners, type QrRect, type QrSnapshot, snapshotAround } from '~/lib/qrDecode';
import { useQrScanner } from '~/lib/useQrScanner';
import type { ShowToast } from '../../utils';
import { parseQrContent, type QrContentKind, type QrFieldKey } from './qrContent';

interface QrScannerProps {
    onBack: () => void;
    showToast: ShowToast;
}

type Bilingual = {en: string; cn: string};
type Icon = ComponentType<{'aria-hidden'?: boolean}>;

// Matches --qrs-frame in admin.css, so a snapshot's filled-in edges blend into the frame.
const FRAME_BACKDROP = '#2a1d2e';

const KINDS: Record<QrContentKind, Bilingual & {icon: Icon}> = {
    url: {en: 'Link', cn: '链接', icon: FiLink},
    email: {en: 'Email', cn: '电子邮件', icon: FiMail},
    phone: {en: 'Phone number', cn: '电话号码', icon: FiPhone},
    sms: {en: 'Text message', cn: '短信', icon: FiMessageSquare},
    geo: {en: 'Location', cn: '地理位置', icon: FiMapPin},
    wifi: {en: 'Wi-Fi network', cn: 'Wi-Fi 网络', icon: FiWifi},
    contact: {en: 'Contact', cn: '联系人', icon: FiUser},
    text: {en: 'Text', cn: '文本', icon: FiFileText},
};

const FIELD_LABELS: Record<QrFieldKey, Bilingual> = {
    subject: {en: 'Subject', cn: '主题'},
    message: {en: 'Message', cn: '内容'},
    label: {en: 'Place', cn: '地点'},
    security: {en: 'Security', cn: '加密方式'},
    password: {en: 'Password', cn: '密码'},
    hidden: {en: 'Hidden network', cn: '隐藏网络'},
    org: {en: 'Organization', cn: '组织'},
    title: {en: 'Job title', cn: '职位'},
    phone: {en: 'Phone', cn: '电话'},
    email: {en: 'Email', cn: '邮箱'},
    website: {en: 'Website', cn: '网站'},
    address: {en: 'Address', cn: '地址'},
    note: {en: 'Note', cn: '备注'},
};

const ACTIONS: Partial<Record<QrContentKind, Bilingual & {icon: Icon}>> = {
    url: {en: 'Open link', cn: '打开链接', icon: FiExternalLink},
    email: {en: 'Write email', cn: '撰写邮件', icon: FiMail},
    phone: {en: 'Call', cn: '拨打', icon: FiPhone},
    geo: {en: 'Open in Google Maps', cn: '在 Google 地图中打开', icon: FiMap},
};

interface ScanResult {
    raw: string;
    source: 'camera' | 'photo';
    snapshot: QrSnapshot | null;
}

/**
 * Reads any QR code — from the camera or a photo — and lays out what's in it,
 * so a link can be checked before anyone opens it. Decoding happens in the
 * browser; photos aren't uploaded anywhere.
 */
export const QrScanner = ({onBack, showToast}: QrScannerProps) => {
    const {isEnglish} = useLanguage();
    const t = (label: Bilingual) => (isEnglish ? label.en : label.cn);

    const [result, setResult] = useState<ScanResult | null>(null);
    const [readingPhoto, setReadingPhoto] = useState(false);
    const [photoMissed, setPhotoMissed] = useState(false);
    const [photoUnreadable, setPhotoUnreadable] = useState(false);
    const photoInputRef = useRef<HTMLInputElement>(null);

    const scanner = useQrScanner({
        onDecode: (raw, corners) => {
            const frame = scanner.canvasRef.current;
            setResult({raw, source: 'camera', snapshot: frame && snapshot(frame, corners)});
            return true;
        },
        onStart: () => {
            setPhotoMissed(false);
            setPhotoUnreadable(false);
        },
        cameraErrorMessage: isEnglish
            ? 'Allow camera access for this site, or choose a photo instead.'
            : '请允许本网站使用摄像头，或改为选择照片。',
        logLabel: '[QrScanner]',
    });

    const onPhotoChosen = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // so choosing the same photo again still fires
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast(isEnglish ? 'Choose an image file.' : '请选择图片文件。', 'error');
            return;
        }
        setPhotoMissed(false);
        setPhotoUnreadable(false);
        setReadingPhoto(true);
        try {
            const read = await decodeQrImage(file);
            if (read) {
                scanner.stopCamera();
                setResult({raw: read.data, source: 'photo', snapshot: snapshot(read.frame, read.corners, read.bounds)});
            } else {
                setPhotoMissed(true);
            }
        } catch (err) {
            console.error('[QrScanner] photo decode', err);
            setPhotoUnreadable(true);
        } finally {
            setReadingPhoto(false);
        }
    };

    const scanAnother = () => {
        const fromCamera = result?.source === 'camera';
        setResult(null);
        if (fromCamera) void scanner.startCamera();
    };

    const copy = (value: string, what: Bilingual) => {
        navigator.clipboard.writeText(value)
            .then(() => showToast(isEnglish ? `${what.en} copied.` : `${what.cn}已复制。`, 'success'))
            .catch(() => showToast(isEnglish ? 'Couldn’t copy. Select the text instead.' : '复制失败，请手动选择文字。', 'error'));
    };

    const stage = result ? 'result' : readingPhoto ? 'reading' : scanner.cameraActive ? 'live' : 'idle';

    // What the frame says when it isn't showing the camera or a result.
    const notice: {icon: Icon; title: string; body?: string; problem?: boolean} | null =
        stage !== 'idle' ? null
            : photoUnreadable ? {
                    icon: FiAlertCircle,
                    problem: true,
                    title: isEnglish ? 'That image couldn’t be opened' : '无法打开该图片',
                    body: isEnglish ? 'Try a JPEG or PNG.' : '请尝试 JPEG 或 PNG 格式。',
                }
                : photoMissed ? {
                        icon: FiAlertCircle,
                        problem: true,
                        title: isEnglish ? 'No QR code in that photo' : '照片中没有找到二维码',
                        body: isEnglish
                            ? 'Try a sharper shot where the code fills more of the frame.'
                            : '换一张更清晰、二维码占画面更大的照片试试。',
                    }
                    : scanner.cameraError ? {
                            icon: FiCameraOff,
                            problem: true,
                            title: isEnglish ? 'Camera unavailable' : '无法使用摄像头',
                            body: scanner.cameraError,
                        }
                        : {icon: FiCamera, title: isEnglish ? 'Camera is off' : '摄像头未开启'};

    const content = result && parseQrContent(result.raw);

    return (
        <div className="admin-section qrs">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'QR Scanner' : '扫码识别'}</h3>
            </div>

            <p className="admin-helper-text">
                {isEnglish ? 'See what a QR code holds before you open it.' : '在打开之前，先看看二维码里有什么。'}
            </p>

            <div
                className={`qrs-frame qrs-frame--${stage}`}
                style={result?.snapshot ? {aspectRatio: `${result.snapshot.width} / ${result.snapshot.height}`} : undefined}
            >
                {/* Mounted in every stage so the camera can always restart into it. */}
                <video ref={scanner.videoRef} playsInline muted className="qrs-video"/>
                <canvas ref={scanner.canvasRef} hidden/>

                {stage !== 'result' && !notice?.problem && (
                    <div className="qrs-reticle" aria-hidden="true">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                            <path
                                d="M2 24V10a8 8 0 0 1 8-8h14M76 2h14a8 8 0 0 1 8 8v14M98 76v14a8 8 0 0 1-8 8H76M24 98H10a8 8 0 0 1-8-8V76"/>
                        </svg>
                        {(stage === 'live' || stage === 'reading') && <span className="qrs-scanline"/>}
                    </div>
                )}

                {notice && (
                    <div className="qrs-notice" role={notice.problem ? 'status' : undefined}>
                        <span className="qrs-notice-icon"><notice.icon aria-hidden/></span>
                        <span className="qrs-notice-title">{notice.title}</span>
                        {notice.body && <span className="qrs-notice-body">{notice.body}</span>}
                    </div>
                )}

                {(stage === 'live' || stage === 'reading') && (
                    <span className="qrs-caption" role="status">
                        {stage === 'live'
                            ? (isEnglish ? 'Hold the code inside the frame' : '将二维码对准取景框')
                            : (isEnglish ? 'Reading photo…' : '正在识别照片…')}
                    </span>
                )}

                {result?.snapshot && (
                    <Snapshot snapshot={result.snapshot}
                              label={isEnglish ? 'The code that was read' : '已识别的二维码'}/>
                )}
            </div>

            <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={e => void onPhotoChosen(e)}/>

            {!result && (
                <>
                    <div className="qrs-controls">
                        {scanner.cameraActive ? (
                            <button className="qrs-btn qrs-btn--quiet" onClick={scanner.stopCamera} type="button">
                                <FiSquare aria-hidden/>{isEnglish ? 'Stop camera' : '关闭摄像头'}
                            </button>
                        ) : (
                            <button className="qrs-btn qrs-btn--primary" onClick={() => void scanner.startCamera()}
                                    disabled={readingPhoto} type="button">
                                <FiCamera aria-hidden/>{isEnglish ? 'Start camera' : '开启摄像头'}
                            </button>
                        )}
                        <button className="qrs-btn qrs-btn--soft" onClick={() => photoInputRef.current?.click()}
                                disabled={readingPhoto} type="button">
                            <FiImage aria-hidden/>{isEnglish ? 'Choose photo' : '选择照片'}
                        </button>
                    </div>
                    <p className="qrs-note">
                        {isEnglish
                            ? 'Photos are read on this device and never uploaded.'
                            : '照片仅在本设备上识别，不会上传。'}
                    </p>
                </>
            )}

            {result && content && (() => {
                const kind = KINDS[content.kind];
                const action = content.href ? ACTIONS[content.kind] : undefined;
                return (
                    <section className="qrs-result" aria-live="polite">
                        <div className="qrs-kind">
                            <span className="qrs-kind-icon"><kind.icon aria-hidden/></span>
                            {t(kind)}
                        </div>

                        {content.kind === 'text' ? (
                            <p className="qrs-text">{content.headline}</p>
                        ) : (
                            <h4 className="qrs-headline">
                                {content.headline || (isEnglish ? '(no name)' : '（无名称）')}
                            </h4>
                        )}
                        {content.detail && <p className="qrs-detail">{content.detail}</p>}

                        {content.fields.length > 0 && (
                            <dl className="qrs-fields">
                                {content.fields.map((field, i) => {
                                    const label = FIELD_LABELS[field.key];
                                    const copyable = field.key !== 'security' && field.key !== 'hidden';
                                    return (
                                        <div key={i} className="qrs-field">
                                            <dt>{t(label)}</dt>
                                            <dd>
                                                {field.key === 'security' && !field.value
                                                    ? (isEnglish ? 'None (open network)' : '无（开放网络）')
                                                    : field.key === 'hidden'
                                                        ? (isEnglish ? 'Yes' : '是')
                                                        : field.value}
                                            </dd>
                                            {copyable ? (
                                                <button className="qrs-copy" type="button"
                                                        onClick={() => copy(field.value, label)}
                                                        aria-label={isEnglish ? `Copy ${label.en.toLowerCase()}` : `复制${label.cn}`}>
                                                    <FiCopy aria-hidden/>
                                                </button>
                                            ) : <span/>}
                                        </div>
                                    );
                                })}
                            </dl>
                        )}

                        <div className="qrs-actions">
                            {action && (
                                <a className="qrs-btn qrs-btn--primary qrs-btn--wide" href={content.href}
                                   target="_blank" rel="noopener noreferrer">
                                    <action.icon aria-hidden/>
                                    {t(action)}
                                </a>
                            )}
                            {content.kind === 'url' ? (
                                <button className="qrs-btn qrs-btn--soft" type="button"
                                        onClick={() => copy(content.detail ?? result.raw, KINDS.url)}>
                                    <FiCopy aria-hidden/>{isEnglish ? 'Copy link' : '复制链接'}
                                </button>
                            ) : (
                                <button className="qrs-btn qrs-btn--soft" type="button"
                                        onClick={() => copy(result.raw, {en: 'Text', cn: '内容'})}>
                                    <FiCopy aria-hidden/>{isEnglish ? 'Copy text' : '复制内容'}
                                </button>
                            )}
                            <button className="qrs-btn qrs-btn--quiet" onClick={scanAnother} type="button">
                                <FiRotateCcw aria-hidden/>{isEnglish ? 'Scan another' : '继续扫描'}
                            </button>
                        </div>

                        {content.kind !== 'text' && content.kind !== 'url' && (
                            <details className="qrs-raw">
                                <summary>{isEnglish ? 'Show raw content' : '查看原始内容'}</summary>
                                <pre>{result.raw}</pre>
                            </details>
                        )}
                    </section>
                );
            })()}
        </div>
    );
};

function snapshot(frame: HTMLCanvasElement, corners: QrCorners, bounds?: QrRect): QrSnapshot | null {
    try {
        return snapshotAround(frame, corners, FRAME_BACKDROP, bounds);
    } catch (err) {
        // A missing snapshot only costs the picture; the result still shows.
        console.error('[QrScanner] snapshot', err);
        return null;
    }
}

/** The frame the code was read from, with everything but the code dimmed. */
function Snapshot({snapshot, label}: {snapshot: QrSnapshot; label: string}) {
    const {url, width, height, corners} = snapshot;
    // Push the outline a little past the code so it doesn't sit on its edge modules.
    const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4;
    const cy = corners.reduce((sum, p) => sum + p.y, 0) / 4;
    const points = corners
        .map(p => `${(cx + (p.x - cx) * 1.1).toFixed(1)},${(cy + (p.y - cy) * 1.1).toFixed(1)}`)
        .join(' ');
    return (
        <svg className="qrs-snapshot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
            <image href={url} width={width} height={height}/>
            <path className="qrs-snapshot-dim" fillRule="evenodd" d={`M0 0H${width}V${height}H0Z M${points}Z`}/>
            <polygon className="qrs-snapshot-outline" points={points} pathLength={1}/>
        </svg>
    );
}
