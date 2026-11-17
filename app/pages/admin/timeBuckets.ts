type Granularity = 'hour' | 'day' | 'week';

const startOfHour = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const startOfWeek = (d: Date): Date => {
    const s = startOfDay(d);
    s.setDate(s.getDate() - s.getDay());
    return s;
};

export const bucketStart: Record<Granularity, (d: Date) => Date> = {
    hour: startOfHour,
    day: startOfDay,
    week: startOfWeek,
};

export const advance: Record<Granularity, (d: Date) => void> = {
    hour: d => d.setHours(d.getHours() + 1),
    day: d => d.setDate(d.getDate() + 1),
    week: d => d.setDate(d.getDate() + 7),
};

export const granularityForSpan = (earliest: Date, latest: Date): Granularity => {
    const spanDays = (latest.getTime() - earliest.getTime()) / 86_400_000;
    return spanDays <= 2 ? 'hour' : spanDays > 92 ? 'week' : 'day';
};

export const formatBucketLabel = (d: Date, granularity: Granularity, isEnglish: boolean): string => {
    if (granularity === 'hour') {
        return isEnglish
            ? d.toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric'})
            : `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}时`;
    }
    return isEnglish
        ? `${d.toLocaleDateString('en-US', {month: 'short'})} ${d.getDate()}`
        : `${d.getMonth() + 1}月${d.getDate()}日`;
};
