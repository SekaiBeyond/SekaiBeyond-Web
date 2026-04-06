import React, { useState } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";

export const About = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const {isEnglish} = useLanguage();

    return (
        <section id="about" className="about-section section">
            <div className="section-header">
                <h2 className="section-title">{isEnglish ? "About Sekai Beyond" : "关于彼世界动漫社"}</h2>
                <p className="section-subtitle">
                    {isEnglish ? "The intersection of dream and reality is where the multiverse breaks the dimensional wall." : "现实与幻想的交汇处，是打破次元壁的平行时空。"}
                </p>
            </div>
            <div className="about-content">
                <div className="about-text">
                    <h3>{isEnglish ? "A diverse anime club created as a space for students who love anime to freely explore" : "专为热爱二次元文化的学生们打造自由的探险之地"}</h3>
                    {isEnglish ? (<p>
                            Here, we support you to become any version of yourself—whether you're a passionate
                            cosplayer, a creative artist, or an energetic dancer.<br/>
                            Sekai Beyond offers you a short escape from the original world. From manga and anime to films
                            and games, we enjoy it all. You might find yourself watching a Lovelive dance performance,
                            enjoying J-pop music in a live house, or chatting with cosplayers at one of our events. We
                            bridge the gap between dream and reality.<br/>
                            While we focus on recreating and cosplaying, we also encourage you to create brand-new stories.
                            Let your imagination run wild! Whether it’s designing new IPs, crafting original characters, or
                            even making a game, Sekai Beyond is where dream and reality merge together. The portal to a
                            multiverse can appear in every corner of campus.<br/>
                            Let’s reach into the Sekai beyond the original world!
                        </p>) :
                        (<p>
                            彼世界 Sekai Beyond 是一个多元化的动漫社团。在彼世界中，我们支持你成为任何形式的自己，无论是喜爱角色扮演的
                            coser、富有创意的画师，还有充满活力的舞者。<br/>
                            探险之途也是回家之路，彼世界是梦想的归宿。它能够带你暂时逃离繁琐的日常生活，坐上通往动漫世界的快车。漫画、动漫、电影，还有游戏都是我们会涉及的领域。你可以在
                            Red Square 参与我们的随机宅舞，在学校里看到live house中的乐队表演，也可以在我们举办的小型漫展上和Coser们来一场打破次元壁的畅谈。<br/>
                            我们专注于复刻和还原动漫中的角色与故事的同时，更希望你来用与时俱进的技术创造全新的故事。尽管大胆提出奇思妙想吧！设计新的IP、绘制原创oc，甚至制作一款游戏……彼世界让现实和幻想鱼水交汇，通往平行时空的传送门会出现在学校的每一个角落。<br/>
                            我们在彼世界等你。
                        </p>)
                    }
                    <div className="about-features">
                        <div className="feature-item">
                            <span className="feature-icon">🎮</span>
                            <span className="feature-text">{isEnglish ? "Game Dev" : "游戏开发"}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">⛏️</span>
                            <span className="feature-text">{isEnglish ? "Minecraft Server" : "我的世界"}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">🎤</span>
                            <span className="feature-text">{isEnglish ? "Idol Performance" : "地偶表演"}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">☕</span>
                            <span className="feature-text">{isEnglish ? "Maid Cafe" : "女仆咖啡"}</span>
                        </div>
                    </div>
                </div>
                <div className="about-image">
                    <div
                        className={`image-container ${isHovering ? 'hovering' : ''}`}
                        onMouseEnter={() => setIsHovering(true)}
                        onMouseLeave={() => setIsHovering(false)}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <img
                            src="/images/mika.png"
                            alt="Sekai Beyond Anime Club"
                            className="about-main-image"
                        />
                        {isHovering && (
                            <div className="hover-prompt">
                                <span className="click-hint">{isEnglish ? "Learn about Mika" : "了解米卡"}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="modal-close"
                            onClick={() => setIsModalOpen(false)}
                            aria-label={isEnglish ? "Close" : "关闭"}
                        >
                            ×
                        </button>
                        <div className="modal-body">
                            <img
                                src="/images/mika.png"
                                alt="Mika"
                                className="modal-image"
                            />
                            <div className="modal-intro">
                                <h4>{isEnglish ? "Meet Mika, Our Anime Club's Adorable Mascot!" : "这是我们的吉祥物 - Mika"}</h4>
                                <p>
                                    {isEnglish ? (
                                        <>
                                            Hey everyone! Say hello to Mika—a total J-Pop dance enthusiast who’d rather
                                            spend a cozy night in than hit up a big party.<br/>
                                            Because of her cute jellyfish-like haircut, everyone lovingly calls her
                                            “Jelly” ≡:)<br/><br/>
                                            She’s super relatable—often cringing at past memories when she’s alone
                                            (we’ve all been there 😅).<br/>
                                            She’s not a gym person, but thanks to her love for dancing and avoiding too
                                            many carbs (they make her sleepy), she naturally stays in great shape.
                                        </>
                                    ) : (
                                        <>
                                            米卡是个会跳舞的宅女，不太擅长社交，更加享受独处的时间。<br/>
                                            因为发型是水母头，所以大家喜欢叫她小水母(:≡<br/><br/>
                                            米卡有替人尴尬的毛病....会在四下无人的时候回想起之前的事情尴尬地扣地（）<br/>
                                            对自己的身材并没有太苛刻的规划，但由于平时有跳宅舞的爱好，外加吃碳水容易犯困不怎么吃，于是身材意外的保持得还不错。
                                        </>
                                    )}
                                </p>
                                <p>
                                    {isEnglish ?
                                        "Whether you're a newcomer to the anime world or an experienced otaku, Mika will guide you to find your own path in Sekai Beyond." :
                                        "无论你是刚踏入动漫世界的新人，还是经验丰富的老宅，Mika 都会引导你找到属于自己的彼世界之路。"
                                    }
                                </p>

                                <div className="intro-features">
                                    <div className="intro-item">
                                        <span className="intro-icon">🦋</span>
                                        <span>{isEnglish ? "MBTI: INFP" : "MBTI类型：INFP （小蝴蝶捏~）"}</span>
                                    </div>
                                    <div className="intro-item">
                                        <span className="intro-icon">🐱</span>
                                        <span>{isEnglish ? "Animal Preference: Neko! But her heart belongs only to her own fluffy white cat, Mino, who has stunning heterochromatic eyes." : "动物偏好：Neko！但只爱自己的猫，名字叫米诺，是个白色长毛异瞳猫。"}</span>
                                    </div>
                                    <div className="intro-item">
                                        <span className="intro-icon">🍡</span>
                                        <span>{isEnglish ? "Food Preference:  Sweets! Especially matcha daifuku—though her tummy isn’t a big fan of anything too icy. " : "食物偏好：甜食，尤其是冰冻的，例如抹茶大福，不过胃对太冷的食物不耐受。"}</span>
                                    </div>
                                    <div className="intro-item">
                                        <span className="intro-icon">🎮</span>
                                        <span>{isEnglish ? "Social Preference: Mika may be shy to make the first move, but she LOVES gaming at home with fellow introverts. Hang out with her for a chill session of controller games or anime marathon!" : "交友偏好：一般不主动交朋友，但喜欢窝在家里和同样社恐的人打游戏。和好朋友聚在一起时喜欢打switch，或者看动漫。"}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};
