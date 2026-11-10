'use client';

/**
 * The live AI interview. Talks to deeptech_ai directly over its WebSocket, the same
 * protocol as deeptech_frontend's MockInterviewPage:
 *
 *   client → server  binary: one recorded answer (audio/webm)
 *   server → client  binary: one spoken line (audio/mpeg)
 *                    text:   {type:'assistant', text} | {type:'closing', finalize_seconds}
 *                            | {type:'completed', ...} | Part 1 frames (usePreAssessment)
 *
 * Part 1 (EQ / Resilience / Grit) runs inside the same socket before the interview.
 * When the session ends deeptech_ai posts the result to the platform API, so this page
 * only has to hand the candidate to their report.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tag, Panel, Scene, Eyebrow } from '@/components/ui';
import { usePreAssessment } from '@/hooks/usePreAssessment';
import { interviewMicrophoneEvent } from '@/components/voice/useSpeechCommands';
import type { Connection } from '@/lib/interviews';
import styles from './InterviewRoom.module.css';

const MAX_TURNS = 12;
const SPEECH_THRESHOLD = 0.018;
const SILENCE_THRESHOLD = 0.008;
const SPEECH_ONSET_MS = 250;
const SILENCE_DURATION_MS = 15_000; // long enough that a thinking pause does not cut a candidate off
const POLL_INTERVAL_MS = 80;
const MAX_RECORDING_MS = 50_000;
const FACE_CHECK_MS = 5_000;

type Phase =
  | 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking'
  | 'processing' | 'wrapping' | 'completed' | 'ended' | 'error';

const PHASE_TEXT: Record<Phase, string> = {
  idle: 'Ready when you are',
  connecting: 'Connecting…',
  ready: 'Your turn — start speaking, or tap the mic',
  listening: 'Listening… tap the mic when you have finished',
  speaking: 'Interviewer speaking',
  processing: 'Thinking…',
  wrapping: 'Wrapping up — preparing your report',
  completed: 'Interview complete',
  ended: 'Interview ended',
  error: 'Connection lost',
};

interface Props {
  interviewId: string;
  connection: Connection;
  /** Fetches a fresh connection (new token) for a retry. */
  refreshConnection: () => Promise<Connection>;
  onFinished: () => void;
}

export function InterviewRoom({ interviewId, connection, refreshConnection, onFinished }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef(connection.token);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onsetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRecTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingClipsRef = useRef<ArrayBuffer[]>([]);
  const isSpeakingRef = useRef(false);
  const isAIPlayingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isClosingRef = useRef(false);
  const turnCountRef = useRef(0);
  const finishedRef = useRef(false);

  const pre = usePreAssessment();
  const { handleFrame, onClipStart, openAnswerWindow, onAnswerSent, canRecord, maxRecordingMs, silenceMs } = pre;

  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [turns, setTurns] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished();
  }, [onFinished]);

  const stopVAD = useCallback(() => {
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    if (onsetTimerRef.current) { clearTimeout(onsetTimerRef.current); onsetTimerRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setLevel(0);
  }, []);

  const cleanup = useCallback(() => {
    stopVAD();
    if (maxRecTimerRef.current) clearTimeout(maxRecTimerRef.current);
    if (faceTimerRef.current) clearInterval(faceTimerRef.current);
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    pendingClipsRef.current = [];
    audioRef.current?.pause();
    audioRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    wsRef.current?.close();
  }, [stopVAD]);

  useEffect(() => cleanup, [cleanup]);

  const rms = useCallback(() => {
    const an = analyserRef.current;
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }, []);

  const sendAudio = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    isProcessingRef.current = true;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    ws.send(await blob.arrayBuffer());
    onAnswerSent();
    setPhase('processing');
  }, [onAnswerSent]);

  const stopRecording = useCallback(() => {
    if (!isSpeakingRef.current) return;
    isSpeakingRef.current = false;
    if (maxRecTimerRef.current) { clearTimeout(maxRecTimerRef.current); maxRecTimerRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(() => {
    if (
      !streamRef.current || isSpeakingRef.current || isAIPlayingRef.current ||
      isProcessingRef.current || isClosingRef.current || turnCountRef.current >= MAX_TURNS || !canRecord()
    ) return;
    isSpeakingRef.current = true;
    chunksRef.current = [];
    try {
      const opts: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) opts.mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) opts.mimeType = 'audio/webm';
      const rec = new MediaRecorder(new MediaStream(streamRef.current.getAudioTracks()), opts);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { void sendAudio(); };
      rec.start();
      setPhase('listening');
      maxRecTimerRef.current = setTimeout(stopRecording, maxRecordingMs(MAX_RECORDING_MS));
    } catch {
      isSpeakingRef.current = false;
      setPhase('ready');
    }
  }, [canRecord, maxRecordingMs, sendAudio, stopRecording]);

  const startVAD = useCallback(() => {
    if (vadTimerRef.current) return;
    vadTimerRef.current = setInterval(() => {
      const v = rms();
      setLevel(Math.min(v / 0.05, 1));
      if (isAIPlayingRef.current) return;
      if (!isSpeakingRef.current) {
        if (v > SPEECH_THRESHOLD) {
          if (!onsetTimerRef.current) {
            onsetTimerRef.current = setTimeout(() => { onsetTimerRef.current = null; startRecording(); }, SPEECH_ONSET_MS);
          }
        } else if (onsetTimerRef.current) {
          clearTimeout(onsetTimerRef.current); onsetTimerRef.current = null;
        }
      } else if (v < SILENCE_THRESHOLD) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => { silenceTimerRef.current = null; stopRecording(); }, silenceMs(SILENCE_DURATION_MS));
        }
      } else if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, [rms, silenceMs, startRecording, stopRecording]);

  const play = useCallback((data: ArrayBuffer, onEnded: () => void) => {
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    audioRef.current = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      audioRef.current = null;
      isAIPlayingRef.current = false;
      isProcessingRef.current = false;
      onEnded();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }, []);

  const faceCheck = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
    }
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 320, 240);
    const image = canvasRef.current.toDataURL('image/jpeg', 0.6).split(',')[1];
    try {
      const res = await fetch(connection.faceCheckUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ image, mock_interview_id: interviewId }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (d.faces_detected === 0) setNotice('No face detected — please stay visible to the camera.');
      else if (d.faces_detected > 1) setNotice('More than one face detected — only you should be visible.');
      else setNotice(null);
    } catch { /* proctoring is best effort */ }
  }, [connection.faceCheckUrl, interviewId]);

  const connect = useCallback(async () => {
    window.dispatchEvent(new Event(interviewMicrophoneEvent));
    setPhase('connecting');
    setNotice(null);
    let conn = connection;
    if (wsRef.current) {
      // A retry: the first token may have expired.
      try { conn = await refreshConnection(); } catch { setPhase('error'); setNotice('Could not reconnect.'); return; }
    }
    tokenRef.current = conn.token;

    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = analyser;
      }
    } catch {
      setPhase('error');
      setNotice('Microphone and camera access is needed for the interview.');
      return;
    }

    const ws = new WebSocket(conn.wsUrl, ['bearer', conn.token]);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    let firstClip = true;

    const playNext = () => {
      const next = pendingClipsRef.current.shift();
      if (!next) return false;
      playClip(next);
      return true;
    };

    const playClip = (data: ArrayBuffer) => {
      isAIPlayingRef.current = true;
      setPhase('speaking');
      const { partOne, question } = onClipStart();
      if (partOne) {
        // Part 1 lines are not interview turns.
        play(data, () => {
          if (playNext()) return;
          if (question) { openAnswerWindow(); setPhase('ready'); startVAD(); }
          else setPhase('processing');
        });
        return;
      }
      if (firstClip) {
        firstClip = false;
        play(data, () => { if (!playNext()) { setPhase('ready'); startVAD(); } });
        return;
      }
      turnCountRef.current += 1;
      setTurns(turnCountRef.current);
      play(data, () => {
        if (playNext()) return;
        if (isClosingRef.current) setPhase('wrapping');
        else if (turnCountRef.current >= MAX_TURNS) setPhase('wrapping');
        else setPhase('ready');
      });
    };

    ws.onopen = () => {
      faceTimerRef.current = setInterval(faceCheck, FACE_CHECK_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        if (isAIPlayingRef.current) pendingClipsRef.current.push(event.data);
        else playClip(event.data);
        return;
      }
      let msg: any;
      try { msg = JSON.parse(String(event.data)); } catch { return; }

      const partOne = handleFrame(msg);
      if (partOne) {
        if (partOne === 'listening') {
          // The answer was silence: the server is still waiting for it.
          isProcessingRef.current = false;
          setPhase('ready');
          setNotice("We didn't catch that — please answer again.");
        } else if (partOne === 'completed') {
          firstClip = true; // the next clip is the interview's opening line
        }
        return;
      }
      if (msg.type === 'assistant' && msg.text) {
        setLines((prev) => [...prev, String(msg.text)]);
        return;
      }
      if (msg.type === 'closing') {
        isClosingRef.current = true;
        stopVAD();
        stopRecording();
        streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
        if (!isAIPlayingRef.current) setPhase('wrapping');
        // The server promises the result within finalize_seconds; release the candidate anyway after.
        const graceMs = ((Number(msg.finalize_seconds) || 95) + 10) * 1000;
        finalizeTimerRef.current = setTimeout(() => { cleanup(); setPhase('ended'); finish(); }, graceMs);
        return;
      }
      if (msg.type === 'completed') {
        cleanup();
        setPhase('completed');
        finish();
      }
    };

    ws.onerror = () => setNotice('Connection error.');
    ws.onclose = (event) => {
      if (finishedRef.current) return;
      if (event.code === 4001) { setPhase('error'); setNotice('The interview session was refused. Please start again.'); return; }
      if (event.code === 4029) { setPhase('error'); setNotice('This interview is already open in another tab.'); return; }
      setPhase((p) => (p === 'wrapping' || p === 'completed' ? p : 'error'));
    };
  }, [cleanup, connection, faceCheck, finish, handleFrame, onClipStart, openAnswerWindow, play, refreshConnection, startVAD, stopRecording, stopVAD]);

  const tapMic = () => {
    if (isAIPlayingRef.current || isProcessingRef.current || isClosingRef.current) return;
    if (phase === 'ready') startRecording();
    else if (phase === 'listening') stopRecording();
  };

  const endNow = () => {
    // Closing the socket makes the server finalise with what it has.
    cleanup();
    setPhase('ended');
    finish();
  };

  const videoCallback = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) node.srcObject = streamRef.current;
  }, []);

  const pv = pre.view;
  const answerLeft = pv.answerEndsAt ? Math.max(0, Math.round((pv.answerEndsAt - now) / 1000)) : null;
  const live = !['idle', 'error', 'completed', 'ended'].includes(phase);

  const latest = lines[lines.length - 1];
  const earlier = lines.slice(0, -1);

  return (
    <div className={styles.room} data-voice-microphone={live ? 'in-use' : undefined}>
      <Panel className={styles.stage}>
        <div className={styles.status}>
          {pv.active ? (
            <Tag color="gold">Part 1 · Question {Math.max(pv.index, 1)} of {pv.total}</Tag>
          ) : (
            <Tag>{pv.done || turns > 0 ? `Turn ${Math.min(turns, MAX_TURNS)} of ${MAX_TURNS}` : 'Interview'}</Tag>
          )}
          <span className={styles.phase}>{PHASE_TEXT[phase]}</span>
          {answerLeft !== null && <span className={styles.timer}>{answerLeft}s</span>}
        </div>

        <div className={styles.media}>
          <video ref={videoCallback} autoPlay muted playsInline className={styles.video} />
          <button
            type="button"
            className={`${styles.mic} ${phase === 'listening' ? styles.micOn : ''}`}
            onClick={tapMic}
            disabled={phase !== 'ready' && phase !== 'listening'}
            aria-label={phase === 'listening' ? 'Finish answer' : 'Start answer'}
            style={{ boxShadow: `0 0 0 ${4 + level * 18}px var(--blue-soft)` }}
          >
            {phase === 'listening' ? '■' : '●'}
          </button>
        </div>

        {latest ? (
          <Scene who="Interviewer">{latest}</Scene>
        ) : (
          phase === 'idle' && (
            <p className={styles.hint}>
              Find a quiet place. The interview starts with six short questions on how you work (Part 1),
              then about 15 minutes on your field. Your camera stays on throughout.
            </p>
          )
        )}

        {notice && <div className={styles.notice}>{notice}</div>}

        <div className={styles.actions}>
          {(phase === 'idle' || phase === 'error') && (
            <Button variant="primary" onClick={() => void connect()}>
              {phase === 'error' ? 'Reconnect' : 'Join interview'}
            </Button>
          )}
          {live && <Button variant="rose" onClick={endNow}>End interview</Button>}
        </div>
      </Panel>

      {earlier.length > 0 && (
        <Panel className={styles.earlier}>
          <Eyebrow>Earlier questions</Eyebrow>
          {earlier.map((l, i) => <p key={i}>{l}</p>)}
        </Panel>
      )}
    </div>
  );
}
