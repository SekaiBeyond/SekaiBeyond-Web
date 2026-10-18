import { useCallback, useEffect, useRef, useState } from 'react';

export type ScanOutcome = 'success' | 'issue';

interface Tone {
    freq: number;
    at: number;
    length: number;
    wave: OscillatorType;
    volume: number;
}

const SOUNDS: Record<ScanOutcome, Tone[]> = {
    success: [
        {freq: 880, at: 0, length: 0.09, wave: 'sine', volume: 0.6},
        {freq: 1320, at: 0.11, length: 0.15, wave: 'sine', volume: 0.6},
    ],
    // Square wave so phone speakers carry the 220 Hz low double buzz via overtones.
    issue: [
        {freq: 220, at: 0, length: 0.18, wave: 'square', volume: 0.3},
        {freq: 220, at: 0.24, length: 0.18, wave: 'square', volume: 0.3},
    ],
};

const RAMP_S = 0.005;

const VIBRATIONS: Record<ScanOutcome, number[]> = {
    success: [50, 50, 50],
    issue: [250, 100, 250],
};

interface ScanSoundControls {
    enabled: boolean;
    setEnabled: (on: boolean) => void;
    play: (outcome: ScanOutcome) => void;
}

export function useScanSound(): ScanSoundControls {
    const [enabled, store] = useDeviceSetting('ticketScanSound');
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const ctxRef = useRef<AudioContext | null>(null);

    const wake = useCallback((): AudioContext | null => {
        if (typeof AudioContext === 'undefined') return null;
        // Safari defaults to 'ambient', which the silent switch mutes.
        const session = audioSession();
        if (session && session.type !== 'playback') session.type = 'playback';
        const ctx = ctxRef.current ??= new AudioContext();
        if (ctx.state !== 'running') {
            void ctx.resume();
            // Older iOS stays locked until something actually plays in the gesture.
            const blip = ctx.createBufferSource();
            blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
            blip.connect(ctx.destination);
            blip.start();
        }
        return ctx;
    }, []);

    useEffect(() => {
        const onGesture = () => {
            if (enabledRef.current) wake();
        };
        const events = ['click', 'touchend', 'keydown'] as const;
        events.forEach(e => document.addEventListener(e, onGesture, true));
        return () => events.forEach(e => document.removeEventListener(e, onGesture, true));
    }, [wake]);

    useEffect(() => () => {
        void ctxRef.current?.close();
        ctxRef.current = null;
        releaseAudioSession();
    }, []);

    const setEnabled = useCallback((on: boolean) => {
        store(on);
        if (on) {
            const ctx = wake();
            if (ctx) void ctx.resume().then(() => playTones(ctx, 'success'));
        } else {
            void ctxRef.current?.suspend();
            releaseAudioSession();
        }
    }, [store, wake]);

    const play = useCallback((outcome: ScanOutcome) => {
        const ctx = ctxRef.current;
        // Not running: no tap yet, or iOS interrupted it. A queued beep would
        // sound at the next tap, long after the scan.
        if (!enabledRef.current || ctx?.state !== 'running') return;
        playTones(ctx, outcome);
    }, []);

    return {enabled, setEnabled, play};
}

interface ScanVibrationControls extends ScanSoundControls {
    supported: boolean;
}

export function useScanVibration(): ScanVibrationControls {
    const [enabled, store] = useDeviceSetting('ticketScanVibrate');
    const [supported, setSupported] = useState(false);

    // Desktop Chrome exposes navigator.vibrate without a motor; coarse pointer identifies handhelds.
    useEffect(() => {
        setSupported('vibrate' in navigator && matchMedia('(pointer: coarse)').matches);
    }, []);

    const setEnabled = useCallback((on: boolean) => {
        store(on);
        if (on && supported) navigator.vibrate(VIBRATIONS.success);
    }, [store, supported]);

    const play = useCallback((outcome: ScanOutcome) => {
        if (enabled && supported) navigator.vibrate(VIBRATIONS[outcome]);
    }, [enabled, supported]);

    return {enabled, setEnabled, play, supported};
}

function useDeviceSetting(key: string): [boolean, (on: boolean) => void] {
    const [on, setOn] = useState(true);

    useEffect(() => {
        if (localStorage.getItem(key) === 'off') setOn(false);
    }, [key]);

    const store = useCallback((value: boolean) => {
        setOn(value);
        localStorage.setItem(key, value ? 'on' : 'off');
    }, [key]);

    return [on, store];
}

function playTones(ctx: AudioContext, outcome: ScanOutcome) {
    const start = ctx.currentTime;
    for (const tone of SOUNDS[outcome]) {
        const t = start + tone.at;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.wave;
        osc.frequency.value = tone.freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(tone.volume, t + RAMP_S);
        gain.gain.setValueAtTime(tone.volume, t + tone.length - RAMP_S);
        gain.gain.linearRampToValueAtTime(0, t + tone.length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + tone.length);
    }
}

/** Safari's Audio Session API; other browsers don't have it. */
function audioSession(): {type: string} | undefined {
    return (navigator as Navigator & {audioSession?: {type: string}}).audioSession;
}

function releaseAudioSession() {
    const session = audioSession();
    if (session) session.type = 'auto';
}
