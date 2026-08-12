import { useLanguage } from '~/components/LanguageContextProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { GoToTop } from '~/components/GoToTop';
import { usePolicy } from '~/lib/policy';

export const PolicyPage = () => {
    const {isEnglish} = useLanguage();
    const {policy, loading} = usePolicy();

    const content = isEnglish ? policy.contentEn : policy.contentCn;

    return (
        <>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <span className="admin-nav-title">{isEnglish ? 'Policy' : '政策'}</span>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                </div>
            </nav>
            <div className="policy-page">
                <div className="policy-container">
                    <h1 className="policy-title">
                        {isEnglish ? 'Policy' : '政策'}
                    </h1>
                    {loading ? (
                        <div className="policy-spinner-wrap">
                            <div className="spinner"/>
                        </div>
                    ) : content ? (
                        <pre className="policy-text">{content}</pre>
                    ) : (
                        <p className="policy-empty">
                            {isEnglish ? 'No policy content available.' : '暂无政策内容。'}
                        </p>
                    )}
                    {!loading && policy.updatedAt && (
                        <p className="policy-updated">
                            {isEnglish
                                ? `Last updated: ${policy.updatedAt.toLocaleDateString()}`
                                : `最后更新：${policy.updatedAt.toLocaleDateString('zh-CN')}`}
                        </p>
                    )}
                    <a href="/" className="policy-back-link">
                        {isEnglish ? '← Back to Home' : '← 返回首页'}
                    </a>
                </div>
            </div>
            <GoToTop/>
        </>
    );
};
