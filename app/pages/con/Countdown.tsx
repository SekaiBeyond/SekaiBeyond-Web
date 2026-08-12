import { useConContent } from '~/lib/conContent';
import { useCountdown } from '~/pages/con/hooks';
import { useT } from '~/pages/con/i18n';
import { pad } from '~/pages/con/utils';

export const Countdown = () => {
    const t = useT();
    const {content} = useConContent();
    const {date, endTime} = content.event;
    const {days, hours, minutes, seconds, started, ended} = useCountdown(date, endTime);

    if (ended) {
        return (
            <p className="sbc-countdown-message">
                {t({
                    en: 'That’s a wrap on this edition — thank you for coming. See you at the next one.',
                    zh: '本届漫展圆满结束，感谢你的到来，下次再见。',
                })}
            </p>
        );
    }

    if (started) {
        return (
            <p className="sbc-countdown-message sbc-countdown-message--live">
                <span className="sbc-countdown-live-dot" aria-hidden="true"/>
                {t({en: 'Happening right now — come find us!', zh: '正在进行中——快来找我们！'})}
            </p>
        );
    }

    const segments = [
        {value: days, label: {en: 'Days', zh: '天'}},
        {value: hours, label: {en: 'Hours', zh: '时'}},
        {value: minutes, label: {en: 'Minutes', zh: '分'}},
        {value: seconds, label: {en: 'Seconds', zh: '秒'}},
    ];

    return (
        <div className="sbc-countdown" role="timer" aria-live="off">
            {segments.map(segment => (
                <div key={segment.label.en} className="sbc-countdown-item">
                    <div className="sbc-countdown-value">{pad(segment.value)}</div>
                    <div className="sbc-countdown-label">{t(segment.label)}</div>
                </div>
            ))}
        </div>
    );
};
