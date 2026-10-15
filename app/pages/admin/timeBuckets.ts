/**
 * Shared bucketing for the admin trend charts: hour, day or week slots by span,
 * empty slots included, labelled in both languages.
 */

type Granularity = 'hour' | 'day' | 'week';

const startOfHour = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const startOfWeek = (d: Date): Date => {
    const s = startOfDay(d);
    s.setDate(s.getDate() - s.getDay());
    return s;
};

/** Truncates a date down to the start of its bucket. */
export const bucketStart: Record<Granularity, (d: Date) => Date> = {
    hour: startOfHour,
    day: startOfDay,
    week: startOfWeek,
};

/** Advance `d` in place by one bucket, so a timeline can include empty buckets. */
export const advance: Record<Granularity, (d: Date) => void> = {
    hour: d => d.setHours(d.getHours() + 1),
    day: d => d.setDate(d.getDate() + 1),
    week: d => d.setDate(d.getDate() + 7),
};

/**
 * Hourly within ~2 days, weekly past ~3 months, daily in between, keeping the
 * bar count readable.
 */
export const granularityForSpan = (earliest: Date, latest: Date): Granularity => {
    const spanDays = (latest.getTime() - earliest.getTime()) / 86_400_000;
    return spanDays <= 2 ? 'hour' : spanDays > 92 ? 'week' : 'day';
};

/** Axis label for a bucket — includes the hour only when bucketing hourly. */
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
