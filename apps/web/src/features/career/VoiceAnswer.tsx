'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import {
  isDictationSupported, levelMeter, micErrorMessage, micPermissionState, requestMicrophone, startDictation,
  type Dictation, type DictationResult, type MicState,
} from './speech';
import styles from './Career.module.css';

/**
 * Microphone answer: permission → record (live caption + level meter) → review → send.
 * Voice only: the parent decides whether to offer typing too (technical) or not (trades).
 */
export function VoiceAnswer({ locale, disabled, onAnswer }: {
  locale: string;
  disabled: boolean;
  onAnswer: (r: DictationResult) => void;
}) {
  const [mic, setMic] = useState<MicState>('unknown');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [caption, setCaption] = useState('');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [level, setLevel] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<ReturnType<typeof levelMeter> | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const raf = useRef<number | null>(null);
  const supported = typeof window !== 'undefined' && isDictationSupported();

  useEffect(() => {
    void micPermissionState().then(setMic);
    return () => release();
  }, []);

  function release() {
    dictation.current?.abort();
    dictation.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    meter.current?.close();
    meter.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function enable(): Promise<boolean> {
    setError('');
    try {
      if (!stream.current) {
        stream.current = await requestMicrophone();
        meter.current = levelMeter(stream.current);
      }
      setMic('granted');
      return true;
    } catch (err) {
      setMic((err as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'unknown');
      setError(micErrorMessage(err));
      return false;
    }
  }

  async function record() {
    if (!(await enable())) return;
    setResult(null);
    setCaption('');
    try {
      dictation.current = startDictation(locale, setCaption, (err) => {
        setError(micErrorMessage(err));
        setRecording(false);
      });
    } catch (err) {
      setError(micErrorMessage(err));
      return;
    }
    setRecording(true);
    const tick = () => {
      setLevel(meter.current?.read() ?? 0);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function stop() {
    if (raf.current) cancelAnimationFrame(raf.current);
    setLevel(0);
    const d = dictation.current;
    dictation.current = null;
    setRecording(false);
    if (!d) return;
    const r = await d.stop();
    setResult(r);
    setCaption(r.transcript);
  }

  if (!supported) {
    return (
      <p className={styles.notice} role="alert">
        Voice answers need speech recognition, available in Chrome, Edge and Safari. Open this page in one of them to continue.
      </p>
    );
  }

  return (
    <div className={styles.stack}>
      {mic === 'denied' && (
        <p className={styles.notice} role="alert">
          Microphone access is blocked for this site. Allow it from the lock icon in the address bar, then press Record.
        </p>
      )}
      <div className={styles.row}>
        {!recording ? (
          <Button variant="primary" disabled={disabled} onClick={() => { void record(); }}>
            {result ? 'Record again' : mic === 'granted' ? 'Record answer' : 'Allow microphone & record'}
          </Button>
        ) : (
          <Button variant="rose" onClick={() => { void stop(); }}>Stop</Button>
        )}
        {recording && (
          <>
            <span className={styles.recDot} aria-hidden="true" />
            <span className={styles.meter} aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></span>
            <span className={styles.muted}>Listening…</span>
          </>
        )}
        {result && !recording && (
          <Button variant="mint" disabled={disabled || !result.transcript} onClick={() => onAnswer(result)}>Send answer</Button>
        )}
      </div>
      <div className={caption ? styles.caption : `${styles.caption} ${styles.captionEmpty}`} aria-live="polite">
        {caption || (recording ? 'Start speaking…' : 'Your words will appear here as you speak.')}
      </div>
      {result && !result.transcript && !recording && <p className={styles.error}>We didn&apos;t catch anything. Record again.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
