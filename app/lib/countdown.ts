export interface Duration {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
}

export const ZERO_DURATION: Duration = {days: 0, hours: 0, minutes: 0, seconds: 0};

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

export const shownCountdownSegments = <T extends {value: number}>(segments: T[]): T[] => {
    const firstShown = segments.findIndex(segment => segment.value > 0);
    return segments.slice(firstShown === -1 ? segments.length - 1 : firstShown);
};
