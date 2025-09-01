import { useState } from "react";

export const Schedule = () => {
    const schedule = {
        friday: [
            {
                time: '10:00 AM',
                title: 'Opening Ceremony',
                titleCn: '开幕式',
                description: 'Grand opening with special performances 盛大开幕与特别表演'
            },
            {
                time: '11:30 AM',
                title: 'Voice Acting Workshop',
                titleCn: '声优工作坊',
                description: 'Learn from professional voice actors 向专业声优学习'
            },
            {
                time: '2:00 PM',
                title: 'Manga Drawing Masterclass',
                titleCn: '漫画绘制大师课',
                description: 'Professional techniques revealed 专业技巧大公开'
            },
            {
                time: '4:00 PM',
                title: 'Gaming Tournament',
                titleCn: '游戏锦标赛',
                description: 'Genshin Impact & more 原神及更多游戏'
            },
            {
                time: '7:00 PM',
                title: 'J-Pop Concert Night',
                titleCn: 'J-Pop演唱会之夜',
                description: 'Live performances all night 整晚的现场表演'
            }
        ],
        saturday: [
            {
                time: '9:00 AM',
                title: 'Vendor Hall Opens',
                titleCn: '商贩大厅开放',
                description: 'Exclusive merchandise awaits 独家周边等你来'
            },
            {
                time: '11:00 AM',
                title: 'Cosplay Contest',
                titleCn: 'Cosplay大赛',
                description: 'Amazing prizes to win 赢取丰厚奖品'
            },
            {
                time: '1:00 PM',
                title: 'Maid Café Experience',
                titleCn: '女仆咖啡厅体验',
                description: 'Authentic maid café service 正宗女仆咖啡厅服务'
            },
            {
                time: '3:30 PM',
                title: 'Guest Panel Q&A',
                titleCn: '嘉宾问答环节',
                description: 'Meet your favorite guests 见见你最喜欢的嘉宾'
            },
            {
                time: '6:00 PM',
                title: 'Anime Karaoke Party',
                titleCn: '动漫卡拉OK派对',
                description: 'Sing your favorite anime songs 唱你最爱的动漫歌曲'
            }
        ],
        sunday: [
            {
                time: '10:00 AM',
                title: 'Chinese ACG Showcase',
                titleCn: '中国ACG展示',
                description: 'Donghua and Chinese games 国漫与国产游戏'
            },
            {
                time: '12:00 PM',
                title: 'Cultural Performance',
                titleCn: '文化表演',
                description: 'Traditional and modern fusion 传统与现代的融合'
            },
            {
                time: '2:30 PM',
                title: 'AMV Contest Finals',
                titleCn: 'AMV大赛决赛',
                description: 'Best anime music videos 最佳动漫音乐视频'
            },
            {
                time: '4:00 PM',
                title: 'Closing Ceremony',
                titleCn: '闭幕式',
                description: 'Final celebrations and prizes 最后的庆祝与抽奖'
            }
        ]
    };
    const [activeDay, setActiveDay] = useState<string>('saturday');

    return (
        <section id="schedule" className="schedule-section">
            <div className="section-header">
                <h2 className="section-title">Event Schedule</h2>
                <h3 className="section-title-cn">活动日程</h3>
                {/*
                    <p className="section-subtitle">
                        Three days of non-stop excitement!<br/>
                        三天不间断的精彩活动！
                    </p>
                    */}
            </div>
            {/*
                <div className="schedule-tabs">
                    <div
                        className={`schedule-tab ${activeDay === 'friday' ? 'active' : ''}`}
                        onClick={() => setActiveDay('friday')}
                    >
                        Friday 周五
                    </div>
                    <div
                        className={`schedule-tab ${activeDay === 'saturday' ? 'active' : ''}`}
                        onClick={() => setActiveDay('saturday')}
                    >
                        Saturday 周六
                    </div>
                    <div
                        className={`schedule-tab ${activeDay === 'sunday' ? 'active' : ''}`}
                        onClick={() => setActiveDay('sunday')}
                    >
                        Sunday 周日
                    </div>
                </div>
                */}
            <div className="schedule-content">
                {schedule[activeDay].map((item: any, index: string) => (
                    <div key={index} className="schedule-item">
                        <div className="schedule-time">{item.time}</div>
                        <div className="schedule-details">
                            <h4>{item.title}</h4>
                            <p className="schedule-details-cn">{item.titleCn}</p>
                            <p>{item.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}