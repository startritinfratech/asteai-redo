/**
 * Voice for the Interview Studio: microphone permission, continuous dictation with live
 * partial text, and reading questions aloud. Uses the Web Speech API (Chromium, Safari);
 * the page's Permissions-Policy allows the microphone for our own origin only.
 */

export type MicState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

/** What to tell the user for a getUserMedia / recognition failure. */
export function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string; error?: string } | null)?.name ?? (err as { error?: string } | null)?.error ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it from the lock icon in the address bar, then try again.';
    case 'NotFoundError':
    case 'audio-capture':
      return 'No microphone was found. Plug one in or check your system sound settings.';
    case 'NotReadableError':
      return 'The microphone is in use by another app. Close it and try again.';
    case 'no-speech':
      return "We didn't hear anything. Check your microphone and speak a little louder.";
    case 'network':
      return 'Speech recognition needs an internet connection.';
    default:
      return 'The microphone could not be started.';
  }
}

export async function micPermissionState(): Promise<MicState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return (status?.state as MicState | undefined) ?? 'unknown';
  } catch {
    return 'unknown'; // Firefox / Safari may not support querying the microphone
  }
}

/** Asks for the microphone. The caller keeps the stream for the level meter and stops it when done. */
export async function requestMicrophone(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
  }
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
}

/** 0–1 input level, polled by the meter. */
export function levelMeter(stream: MediaStream): { read: () => number; close: () => void } {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return { read: () => 0, close: () => {} };
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  return {
    read: () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 64);
    },
    close: () => { void ctx.close(); },
  };
}

// ── Recognition ──

interface Alt { transcript: string; confidence: number }
interface Result { isFinal: boolean; length: number; [i: number]: Alt }
interface ResultEvent { resultIndex: number; results: { length: number; [i: number]: Result } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isDictationSupported = () => recognitionCtor() !== null;

export interface DictationResult { transcript: string; confidence: number | undefined; durationMs: number }

export interface Dictation {
  /** Stops listening and resolves with everything heard. */
  stop: () => Promise<DictationResult>;
  abort: () => void;
}

/**
 * Listens until stop(). `onText` gets the running transcript (final + interim) for the
 * live caption. Browsers end recognition after a silence, so it restarts itself until
 * the user presses stop.
 */
export function startDictation(locale: string, onText: (text: string) => void, onError: (err: unknown) => void): Dictation {
  const Ctor = recognitionCtor();
  if (!Ctor) throw Object.assign(new Error('unsupported'), { name: 'unsupported' });
  const started = Date.now();
  const finals: string[] = [];
  const confidences: number[] = [];
  let interim = '';
  let stopping = false;
  let done: ((r: DictationResult) => void) | null = null;

  const result = (): DictationResult => ({
    transcript: [...finals, interim].join(' ').replace(/\s+/g, ' ').trim(),
    confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined,
    durationMs: Date.now() - started,
  });

  const rec = new Ctor();
  rec.lang = locale;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finals.push(r[0].transcript);
        if (r[0].confidence > 0) confidences.push(r[0].confidence);
      } else {
        interim += r[0].transcript;
      }
    }
    onText(result().transcript);
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    stopping = true;
    onError(e);
  };
  rec.onend = () => {
    if (stopping) {
      done?.(result());
      return;
    }
    try { rec.start(); } catch { /* already restarting */ }
  };
  rec.start();

  return {
    stop: () => new Promise<DictationResult>((resolve) => {
      stopping = true;
      done = resolve;
      rec.stop();
    }),
    abort: () => {
      stopping = true;
      rec.abort();
    },
  };
}

// ── Synthesis ──

export const isSpeechOutputSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Reads `text` aloud; resolves when finished (or at once if speech output is unavailable). */
export function speakText(text: string, locale: string): Promise<void> {
  if (!text || !isSpeechOutputSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang === locale)
      ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(locale.split('-')[0]));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
}
