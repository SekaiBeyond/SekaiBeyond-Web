import { Link } from 'react-router';
import { useT } from '~/pages/con/i18n';

/**
 * What the public sees while the con page is switched off in the admin panel.
 * Deliberately says nothing about the line-up, the date, or the venue — an
 * unpublished page is usually unpublished because those are not settled.
 */
export const Unpublished = () => {
    const t = useT();

    return (
        <div className="sbc-unpublished">
            <div className="sbc-unpublished-card">
                <span className="sbc-unpublished-mark" aria-hidden="true">✦</span>
                <h1 className="sbc-unpublished-title">
                    {t({en: 'Something is coming', zh: '敬请期待'})}
                </h1>
                <p className="sbc-unpublished-body">
                    {t({
                        en: 'Sekai Beyond Con is still being put together. Check back soon, or follow us to hear the moment it goes live.',
                        zh: '彼世界漫展正在筹备中。请稍后再来，或关注我们以第一时间获知最新消息。',
                    })}
                </p>
                <Link className="btn btn-primary" to="/">
                    <span>{t({en: 'Back to Sekai Beyond', zh: '返回彼世界主站'})}</span>
                </Link>
            </div>
        </div>
    );
};
