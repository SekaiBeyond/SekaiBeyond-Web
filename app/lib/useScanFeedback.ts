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

// Synthesised rather than audio files: nothing to download or allow in the CSP,
// and it plays the moment it's asked to.
const SOUNDS: Record<ScanOutcome, Tone[]> = {
    // Two quick rising beeps, the checkout "accepted".
    success: [
        {freq: 880, at: 0, length: 0.09, wave: 'sine', volume: 0.6},
        {freq: 1320, at: 0.11, length: 0.15, wave: 'sine', volume: 0.6},
    ],
    // A low double buzz, unlike the chirp in both pitch and timbre so the two
    // can't be mistaken over a noisy queue. Square, because a phone speaker
    // hardly reproduces 220 Hz itself; its overtones are what carry.
    issue: [
        {freq: 220, at: 0, length: 0.18, wave: 'square', volume: 0.3},
        {freq: 220, at: 0.24, length: 0.18, wave: 'square', volume: 0.3},
    ],
};

/** Fade in and out over this many seconds, so tones don't click. */
const RAMP_S = 0.005;

// On/off milliseconds. Two of each, like the sounds, but short taps against
// long buzzes so they can be told apart by feel alone.
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
 * Beeps for ticket scan results, switched on or off per device. Browsers only
 * let audio start from a tap or key press, and a scan result arrives with no
 * gesture behind it, so the audio is woken by the operator's own taps (Start
 * Camera, Redeem, the toggle) and results play through it once it's running.
 */
export function useScanSound(): ScanSoundControls {
    const [enabled, store] = useDeviceSetting('ticketScanSound');
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const ctxRef = useRef<AudioContext | null>(null);

    // Only does anything from inside a gesture handler.
    const wake = useCallback((): AudioContext | null => {
        if (typeof AudioContext === 'undefined') return null;
        // Safari's default for web audio is 'ambient', which the iPhone's silent
        // switch mutes; whoever turned sound on here wants to hear it.
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
            // The toggle's own tap can wake the audio, and a sample straight away
            // lets whoever turned it on check the volume.
            const ctx = wake();
            if (ctx) void ctx.resume().then(() => playTones(ctx, 'success'));
        } else {
            void ctxRef.current?.suspend();
            releaseAudioSession();
        }
    }, [store, wake]);

    const play = useCallback((outcome: ScanOutcome) => {
        const ctx = ctxRef.current;
        // Not running means no tap has woken it yet, or iOS interrupted it. A
        // beep queued now would only go off at the next tap, long after the scan.
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
 * Vibration for ticket scan results, switched on or off per device. Android
 * only: iOS has no Vibration API. Like audio, Chrome ignores it until the page
 * has been tapped, which Start Camera always is before a scan.
 */
export function useScanVibration(): ScanVibrationControls {
    const [enabled, store] = useDeviceSetting('ticketScanVibrate');
    const [supported, setSupported] = useState(false);

    // Desktop Chrome has the API with no motor behind it; a coarse pointer is
    // the best sign of a phone or tablet in hand.
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
