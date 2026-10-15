import { useCallback, useEffect, useRef, useState } from 'react';

/** What a scan came to, as far as the person at the door needs to hear or feel it. */
export type ScanOutcome = 'success' | 'issue';

interface Tone {
    /** Pitch, in Hz. */
    freq: number;
    /** Seconds after the sound starts. */
    at: number;
    /** Seconds. */
    length: number;
    wave: OscillatorType;
    volume: number;
}

// Synthesised: nothing to download or allow in the CSP, and no delay.
const SOUNDS: Record<ScanOutcome, Tone[]> = {
    // Two quick rising beeps, the checkout "accepted".
    success: [
        {freq: 880, at: 0, length: 0.09, wave: 'sine', volume: 0.6},
        {freq: 1320, at: 0.11, length: 0.15, wave: 'sine', volume: 0.6},
    ],
    // A low double buzz, unmistakable for the chirp over a noisy queue. Square,
    // because phone speakers barely reproduce 220 Hz and its overtones carry.
    issue: [
        {freq: 220, at: 0, length: 0.18, wave: 'square', volume: 0.3},
        {freq: 220, at: 0.24, length: 0.18, wave: 'square', volume: 0.3},
    ],
};

/** Fade in and out over this many seconds, so tones don't click. */
const RAMP_S = 0.005;

// On/off milliseconds: short taps against long buzzes, told apart by feel.
const VIBRATIONS: Record<ScanOutcome, number[]> = {
    success: [50, 50, 50],
    issue: [250, 100, 250],
};

export interface ScanSoundControls {
    enabled: boolean;
    setEnabled: (on: boolean) => void;
    play: (outcome: ScanOutcome) => void;
}

/**
 * Beeps for ticket scan results, on or off per device. Audio can only start
 * from a gesture and results arrive without one, so the operator's own taps
 * (Start Camera, Redeem, the toggle) wake it.
 */
export function useScanSound(): ScanSoundControls {
    const [enabled, store] = useDeviceSetting('ticketScanSound');
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const ctxRef = useRef<AudioContext | null>(null);

    // Only does anything from inside a gesture handler.
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
            // The toggle's tap wakes the audio, and a sample lets them check the
            // volume.
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

export interface ScanVibrationControls extends ScanSoundControls {
    /** Whether this device can vibrate, and so whether a toggle is worth showing. */
    supported: boolean;
}

/**
 * Vibration for ticket scan results, on or off per device. Android only (iOS
 * has no Vibration API), and like audio it needs a prior tap, which Start
 * Camera always is.
 */
export function useScanVibration(): ScanVibrationControls {
    const [enabled, store] = useDeviceSetting('ticketScanVibrate');
    const [supported, setSupported] = useState(false);

    // Desktop Chrome has the API without a motor; a coarse pointer is the best
    // sign of a handheld.
    useEffect(() => {
        setSupported('vibrate' in navigator && matchMedia('(pointer: coarse)').matches);
    }, []);

    const setEnabled = useCallback((on: boolean) => {
        store(on);
        // A sample, so whoever turned it on knows it works on this phone.
        if (on && supported) navigator.vibrate(VIBRATIONS.success);
    }, [store, supported]);

    const play = useCallback((outcome: ScanOutcome) => {
        if (enabled && supported) navigator.vibrate(VIBRATIONS[outcome]);
    }, [enabled, supported]);

    return {enabled, setEnabled, play, supported};
}

/** An on/off setting kept on this device, on until switched off. */
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
