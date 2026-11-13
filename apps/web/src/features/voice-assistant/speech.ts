/**
 * Browser speech in and out (Web Speech API).
 *
 * Recognition exists in Chromium browsers and Safari; elsewhere the assistant falls
 * back to a typed command box. Server-side transcription (deeptech_ai's Whisper
 * endpoint) is the planned fallback for those browsers.
 */

interface RecognitionAlternative { transcript: string }
interface RecognitionResultList { [index: number]: { [index: number]: RecognitionAlternative } ; length: number }
interface RecognitionEvent { results: RecognitionResultList }
interface RecognitionErrorEvent { error: string }

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return recognitionCtor() !== null;
}

export class SpeechError extends Error {
  constructor(readonly code: string) {
    super(code === 'not-allowed' ? 'Microphone access was blocked.' : code === 'no-speech' ? "I didn't hear anything." : 'Speech recognition failed.');
  }
}

export interface Listening {
  result: Promise<string>;
  cancel: () => void;
}

/** Listens for one phrase. `result` resolves with the transcript ('' if cancelled). */
export function listenOnce(lang: string): Listening {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new SpeechError('unsupported')), cancel: () => {} };

  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  const result = new Promise<string>((resolve, reject) => {
    let transcript = '';
    rec.onresult = (e) => { transcript = e.results[0]?.[0]?.transcript ?? ''; };
    rec.onerror = (e) => { if (e.error !== 'aborted') reject(new SpeechError(e.error)); };
    rec.onend = () => resolve(transcript.trim());
  });
  rec.start();
  return { result, cancel: () => rec.abort() };
}

export function speak(text: string, lang: string) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
