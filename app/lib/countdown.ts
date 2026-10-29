export interface Duration {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
}

export const ZERO_DURATION: Duration = {days: 0, hours: 0, minutes: 0, seconds: 0};

/** `ms` as whole days, hours, minutes and seconds; zero for none or less. */
export const splitDuration = (ms: number): Duration => {
    if (!(ms > 0)) return ZERO_DURATION;
    const seconds = Math.floor(ms / 1000);
    return {
        days: Math.floor(seconds / 86400),
        hours: Math.floor((seconds % 86400) / 3600),
        minutes: Math.floor((seconds % 3600) / 60),
        seconds: seconds % 60,
    };
};

/**
 * The boxes a countdown shows. Leading units at 0 drop out (no "00 Days" a day
 * out), down to seconds. A 0 after a larger unit stays, so 2 days 0 hours keeps
 * its Hours box.
 */
export const shownCountdownSegments = <T extends {value: number}>(segments: T[]): T[] => {
    const firstShown = segments.findIndex(segment => segment.value > 0);
    return segments.slice(firstShown === -1 ? segments.length - 1 : firstShown);
};
