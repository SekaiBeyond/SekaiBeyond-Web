import { useLanguage } from "~/components/LanguageContextProvider";
import { useSiteConfig } from "~/lib/siteConfig";

export const Team = () => {
    const {isEnglish} = useLanguage();
    const {config, loading} = useSiteConfig();

    if (loading || !config.teamMembers || config.teamMembers.length === 0) {
        return null;
    }

    const teamData = config.teamMembers;

    return (
        <section id="team" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Our Team" : "我们的团队"}</h2>
                <p className="section-subtitle">{isEnglish ? "Meet the passionate people behind Sekai Beyond" : "认识彼世界背后的热情团队"}</p>
            </div>
            <div className="team-grid">
                {teamData.map((member) => (
                    <div key={member.id} className="team-card">
                        <img className="team-avatar" src={member.imageUrl} alt={member.name}/>
                        <h3 className="team-name">{!isEnglish && member.nameCn ? member.nameCn : member.name}</h3>
                        <p className="team-role">{isEnglish ? member.role : member.roleCn}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}