import { useMemo } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { DAY_MINUTES, type LotStatus, type Segment } from '~/lib/parkingStatus';

/**
 * The parking guide's copy in both site languages. Placeholders in braces are
 * filled by `t`. Kept in one table, like the approved mockup's, because most of
 * the page is built from short phrases that have to stay in step across languages.
 */
const EN = {
    back: 'Back to Home', title: 'Parking Guide', viewingFor: 'Viewing parking for', selectVenue: 'Select a venue',
    searchVenues: 'Search venues…', noVenues: 'No venues found', thisEvent: 'This event',
    yourEvent: 'Your event', rightNow: 'Parking right now', rightNowSub: 'Statuses show parking at this moment.',
    otherVenue: 'You’re viewing parking for {v}.', backToEventVenue: 'Switch back to {v}',
    suggested: 'Suggested lots for {v}', suggestedSub: 'Picked by the organizers', all: 'All visitor lots', lotsCount: '{n} lots',
    searchLots: 'Search parking lots…',
    f_free: 'Free during event', f_freeNow: 'Free now', f_ada: '♿ Accessible', f_ev: '⚡ EV charging', f_moto: 'Motorcycle', f_garage: 'Garages',
    noLots: 'No parking lots found. Clear a filter or the search.',
    walkTo: '{n} min walk to {v}', walkShort: '{n} min walk', walkMin: '{n} min', pick: '#{n} pick', details: 'Details',
    backList: 'All lots', secEvent: 'For your event', secNow: 'Right now', secRates: 'Rates', secHours: 'Hours & access',
    secPay: 'How to pay', secStalls: 'Stalls', secClear: 'Height limit', secOverflow: 'If it’s full', secAlso: 'Also here',
    secTour: 'See it before you go',
    hourly: 'Hourly', daily: 'Daily', night: 'Night', noRate: 'No visitor rate listed. Check the signs at the lot.',
    weekday: 'Weekday', monFri: 'Mon–Fri', sat: 'Saturday', sun: 'Sunday', free: 'Free', h24: '24 hours', gate: 'Gates open',
    accessLbl: 'Who can park', access_pp: 'Permit or pay', access_pay: 'Pay to park',
    hours_pay: 'pay {r}', hours_permit: 'permits only {r}',
    pbp: 'PayByPhone zone', copy: 'Copy', copied: 'Copied', selfServe: 'Self-serve pay station on site.',
    s_standard: 'Standard', s_compact: 'Compact', s_accessible: 'Accessible', s_motorcycle: 'Motorcycle', s_ev: 'EV charging',
    overflowLead: 'UW lists these as overflow lots:', zipcar: 'Zipcar', ucar: 'UCAR rental cars', dar: 'Dial-A-Ride shuttle',
    tour: 'Open UW’s 360° tour', tourSub: 'UW’s parking map has a photo tour of this lot.', directions: 'Directions',
    note: 'Note from the organizers', clearance: '{ft} ({in} in)',
    whyPaid: '{day} paid hours: {w}.', whyHours: '{day} hours: {w}.', whySun: 'No paid hours on Sundays.',
    whyNone: 'No paid hours listed for {day}.', whyEvent: 'UW event pricing applies on this day: ${p}{when}.',
    whyYourEvent: 'Your event: {e}.', whyItsNow: 'It’s now {e}.',
    legendEvent: 'During your event', legendNow: 'Right now', lg_free: 'Free', lg_part: 'Pay part of the time', lg_paid: 'Pay',
    lg_permit: 'Permits only', lg_event: 'Event pricing', lg_pick: 'Suggested lot', lg_venue: 'Event venue',
    lg_other: 'Other venues (click to switch)',
    bannerAll: '{d}: ${p} event parking in all campus lots{when}.', bannerSome: '{d}: ${p} event parking in {lots}{when}.',
    bannerSrc: 'UW event parking calendar',
    credit: 'Lot data: {uw}, updated {d}. Walking times: OpenStreetMap.', uw: 'UW Transportation Services',
    recenter: 'Back to {v}', allDay: ', all day', venueHover: 'View parking for this venue', venueCode: 'UW building {c}',
    mapLabel: 'Campus parking map', panelLabel: 'Parking lots', mapFailed: 'The map couldn’t load. Reload the page to try again.',
    loading: 'Loading parking guide…',
    notFoundTitle: 'Event Not Found', notFoundDesc: 'The event you’re looking for doesn’t exist or has been removed.',
    noVenuesTitle: 'Parking Guide Unavailable',
    noVenuesDesc: 'No parking guides are available yet. Check back later or contact the organizers.',
    chooseTitle: 'Choose a Venue', chooseDesc: 'Pick a venue above to see its parking map and nearby lots.',
    noDataTitle: 'Lot details are on their way',
    noDataDesc: 'We couldn’t load UW’s parking data just now. UW’s own visitor parking page has everything in the meantime.',
    st_event: '${p} event parking', st_allDay: 'Pay to park all day',
    st_only_free: 'Free during your event', st_only_pay: 'Pay during your event', st_only_permit: 'Permits only during your event',
    st_now_free: 'Free now', st_now_pay: 'Pay now', st_now_permit: 'Permits only now',
    'st_pay>free': 'Pay until {t}, then free', 'st_free>pay': 'Free until {t}, then pay',
    'st_permit>pay': 'Permits only until {t}, then pay', 'st_pay>permit': 'Pay until {t}, then permits only',
    'st_permit>free': 'Permits only until {t}, then free', 'st_free>permit': 'Free until {t}, then permits only',
};

type TextKey = keyof typeof EN;

const ZH: Record<TextKey, string> = {
    back: '返回首页', title: '停车指南', viewingFor: '查看停车场地', selectVenue: '选择场地',
    searchVenues: '搜索场地…', noVenues: '未找到场地', thisEvent: '本次活动',
    yourEvent: '你的活动', rightNow: '当前停车情况', rightNowSub: '状态显示的是此刻的停车情况。',
    otherVenue: '你正在查看 {v} 的停车信息。', backToEventVenue: '切换回 {v}',
    suggested: '{v} 推荐停车场', suggestedSub: '由主办方挑选', all: '所有访客停车场', lotsCount: '{n} 个',
    searchLots: '搜索停车场…',
    f_free: '活动期间免费', f_freeNow: '现在免费', f_ada: '♿ 无障碍', f_ev: '⚡ 电动车充电', f_moto: '摩托车', f_garage: '停车楼',
    noLots: '未找到停车场。请清除筛选条件或搜索内容。',
    walkTo: '步行 {n} 分钟到 {v}', walkShort: '步行 {n} 分钟', walkMin: '{n} 分钟', pick: '推荐 #{n}', details: '详情',
    backList: '返回列表', secEvent: '本次活动', secNow: '当前', secRates: '费率', secHours: '收费时间与停车资格',
    secPay: '付款方式', secStalls: '车位', secClear: '限高', secOverflow: '停满时', secAlso: '其他服务',
    secTour: '出发前先看看',
    hourly: '按小时', daily: '按天', night: '夜间', noRate: '未公布访客费率，请以现场标识为准。',
    weekday: '工作日', monFri: '周一至周五', sat: '周六', sun: '周日', free: '免费', h24: '24 小时', gate: '开放时间',
    accessLbl: '停车资格', access_pp: '持证或付费', access_pay: '付费停车',
    hours_pay: '付费 {r}', hours_permit: '仅限持证 {r}',
    pbp: 'PayByPhone 区号', copy: '复制', copied: '已复制', selfServe: '现场设有自助缴费机。',
    s_standard: '标准', s_compact: '紧凑型', s_accessible: '无障碍', s_motorcycle: '摩托车', s_ev: '电动车充电',
    overflowLead: 'UW 列出的备用停车场：', zipcar: 'Zipcar 共享汽车', ucar: 'UCAR 租车', dar: 'Dial-A-Ride 接驳车',
    tour: '打开 UW 360° 实景', tourSub: 'UW 停车地图提供该停车场的实景照片。', directions: '导航',
    note: '主办方提示', clearance: '{m} 米（{in} 英寸）',
    whyPaid: '{day}收费时间：{w}。', whyHours: '{day}时间：{w}。', whySun: '周日不收费。',
    whyNone: '{day}未列出收费时间。', whyEvent: '当天适用 UW 活动停车价：${p}{when}。',
    whyYourEvent: '活动时间：{e}。', whyItsNow: '现在是 {e}。',
    legendEvent: '活动期间', legendNow: '当前', lg_free: '免费', lg_part: '部分时间付费', lg_paid: '需付费',
    lg_permit: '仅限持证', lg_event: '活动停车价', lg_pick: '推荐停车场', lg_venue: '活动场地',
    lg_other: '其他场地（点击切换）',
    bannerAll: '{d}：全校停车场实行活动停车价 ${p}{when}。', bannerSome: '{d}：{lots} 实行活动停车价 ${p}{when}。',
    bannerSrc: 'UW 活动停车日历',
    credit: '停车场数据：{uw}，更新于 {d}。步行时间：OpenStreetMap。', uw: 'UW Transportation Services',
    recenter: '回到 {v}', allDay: '（全天）', venueHover: '查看此场地的停车信息', venueCode: 'UW 建筑代码 {c}',
    mapLabel: '校园停车地图', panelLabel: '停车场', mapFailed: '地图加载失败，请刷新页面重试。',
    loading: '加载停车指南…',
    notFoundTitle: '未找到活动', notFoundDesc: '您查找的活动不存在或已被移除。',
    noVenuesTitle: '停车指南暂不可用',
    noVenuesDesc: '暂无停车指南。请稍后查看或联系主办方。',
    chooseTitle: '选择场地', chooseDesc: '在上方选择场地，即可查看其停车地图及附近停车场。',
    noDataTitle: '停车场信息即将上线',
    noDataDesc: '暂时无法加载 UW 停车数据。你可以先查看 UW 的访客停车页面。',
    st_event: '活动停车价 ${p}', st_allDay: '全天需付费',
    st_only_free: '活动期间免费', st_only_pay: '活动期间需付费', st_only_permit: '活动期间仅限持证',
    st_now_free: '现在免费', st_now_pay: '现在需付费', st_now_permit: '现在仅限持证',
    'st_pay>free': '{t} 前需付费，之后免费', 'st_free>pay': '{t} 前免费，之后需付费',
    'st_permit>pay': '{t} 前仅限持证，之后可付费停车', 'st_pay>permit': '{t} 前可付费停车，之后仅限持证',
    'st_permit>free': '{t} 前仅限持证，之后免费', 'st_free>permit': '{t} 前免费，之后仅限持证',
};

const LOT_TYPES: Record<string, {en: string; zh: string}> = {
    'Surface Lot': {en: 'Surface lot', zh: '地面停车场'},
    'Garage': {en: 'Garage', zh: '停车楼'},
    'Underground Garage': {en: 'Underground garage', zh: '地下停车库'},
};

const AREAS: Record<string, {en: string; zh: string}> = {
    North: {en: 'North campus', zh: '北校区'},
    Central: {en: 'Central campus', zh: '中校区'},
    South: {en: 'South campus', zh: '南校区'},
    East: {en: 'East campus', zh: '东校区'},
    West: {en: 'West campus', zh: '西校区'},
};

const DAYS = {en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六']};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ParkingText = ReturnType<typeof makeText>;

function makeText(isEnglish: boolean) {
    const table = isEnglish ? EN : ZH;
    const lang = isEnglish ? 'en' : 'zh';

    const t = (key: TextKey, vars?: Record<string, string | number>): string => {
        let text = table[key];
        if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
        return text;
    };

    /** Minutes since midnight as a clock time: "11 am", "4:30 pm"; 24-hour "11:00" in Chinese. */
    const time = (minutes: number): string => {
        if (minutes >= DAY_MINUTES) return isEnglish ? 'midnight' : '24:00';
        const h = Math.floor(minutes / 60), m = minutes % 60;
        if (!isEnglish) return `${h}:${String(m).padStart(2, '0')}`;
        const h12 = h % 12 || 12;
        return `${m ? `${h12}:${String(m).padStart(2, '0')}` : h12} ${h < 12 ? 'am' : 'pm'}`;
    };
    const range = (start: number, end: number) => `${time(start)}${isEnglish ? ' – ' : '–'}${time(end)}`;

    /** A YYYY-MM-DD date: "Sat, Oct 24" / "10月24日 周六". */
    const date = (iso: string): string => {
        const [y, m, d] = iso.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return isEnglish ? `${DAYS.en[dow]}, ${MONTHS[m - 1]} ${d}` : `${m}月${d}日 ${DAYS.zh[dow]}`;
    };

    const money = (n: number) => Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;

    /** When an event rate is in effect: ", 6 am – 8 pm" / ", all day". */
    const pricingWhen = (p: {start: string | null; end: string | null}): string => {
        if (!p.start || !p.end) return t('allDay');
        const [sh, sm] = p.start.split(':').map(Number), [eh, em] = p.end.split(':').map(Number);
        const r = range(sh * 60 + sm, eh * 60 + em || DAY_MINUTES);
        return isEnglish ? `, ${r}` : `（${r}）`;
    };

    const status = (s: LotStatus): string => {
        const p = s.phrase;
        if (p.key === 'event') return t('st_event', {p: p.price});
        if (p.key === 'allDay') return t('st_allDay');
        if (p.key === 'only') return t(`st_${s.isNow ? 'now' : 'only'}_${p.segment}` as TextKey);
        return t(`st_${p.from}>${p.to}` as TextKey, {t: time(p.at)});
    };

    /** A lot's non-free hours on a day: "6 am – 9 pm", or "permits only 6 am – 4 pm, pay 4 – 9 pm". */
    const hours = (day: LotStatus['day']): string => {
        const paid = day.filter(s => s.segment !== 'free');
        if (paid.length === 0) return t('free');
        if (paid.length === 1 && paid[0].segment === 'pay' && paid[0].start === 0 && paid[0].end === DAY_MINUTES) {
            return t('h24');
        }
        if (paid.every(s => s.segment === 'pay')) return paid.map(s => range(s.start, s.end)).join(', ');
        return paid.map(s => t(`hours_${s.segment as Exclude<Segment, 'free'>}`, {r: range(s.start, s.end)}))
            .join(isEnglish ? ', ' : '，');
    };

    const lotType = (type: string) => LOT_TYPES[type]?.[lang] ?? type;
    const area = (name: string) => AREAS[name]?.[lang] ?? name;

    return {isEnglish, t, time, range, date, money, pricingWhen, status, hours, lotType, area};
}

export function useParkingText(): ParkingText {
    const {isEnglish} = useLanguage();
    return useMemo(() => makeText(isEnglish), [isEnglish]);
}
