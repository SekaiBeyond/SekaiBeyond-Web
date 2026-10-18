import { useEffect, useState } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { callGetPublicTeamMembers } from "~/lib/firebase";
import { type TeamMemberConfig, useSiteConfig } from "~/lib/siteConfig";

export const Team = () => {
    const {isEnglish} = useLanguage();
    const {config, loading} = useSiteConfig();
    // Linked-account fields are resolved via callable since users docs aren't publicly readable.
    const [resolvedMembers, setResolvedMembers] = useState<TeamMemberConfig[] | null>(null);

    useEffect(() => {
        let active = true;
        callGetPublicTeamMembers()
            .then(res => {
                if (active) setResolvedMembers(res.data.teamMembers);
            })
            .catch(() => {
            });
        return () => {
            active = false;
        };
    }, []);

    const teamData = resolvedMembers ?? config.teamMembers ?? [];

    if (!loading && teamData.length === 0) {
        return null;
    }
    const activeMembers = teamData.filter(m => !m.isHonorary);
    const honoraryMembers = teamData.filter(m => m.isHonorary);

    const renderCard = (member: TeamMemberConfig, honorary: boolean) => (
        <div key={member.id} className={honorary ? "team-card team-card--honorary" : "team-card"}>
            <img className="team-avatar" src={member.imageUrl || "/mika.webp"} alt={member.name}/>
            <h3 className="team-name">{!isEnglish && member.nameCn ? member.nameCn : member.name}</h3>
            <p className="team-role">{!isEnglish && member.roleCn ? member.roleCn : member.role}</p>
        </div>
    );

    return (
        <section id="team" className="section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "Our Team" : "我们的团队"}</h2>
                <p className="section-subtitle">{isEnglish ? "Meet the passionate people behind Sekai Beyond" : "认识彼世界背后的热情团队"}</p>
            </div>

            {activeMembers.length > 0 && (
                <div className="team-grid">
                    {activeMembers.map(m => renderCard(m, false))}
                </div>
            )}

            {honoraryMembers.length > 0 && (
                <>
                    <div className="team-subheading">
                        <span>{isEnglish ? "Honorary Members" : "名誉成员"}</span>
                    </div>
                    <div className="team-grid team-grid--honorary">
                        {honoraryMembers.map(m => renderCard(m, true))}
                    </div>
                </>
            )}
        </section>
    )
}
