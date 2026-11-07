'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const interviewMicrophoneEvent = 'asteai:interview-microphone';
const interviewSelector = '[data-voice-microphone="in-use"]';

type Recognition = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};

function recognitionConstructor() {
  const browser = window as Window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function useSpeechCommands(onCommand: (command: string) => void, onNotice: (notice: string) => void) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const callbacks = useRef({ onCommand, onNotice });
  callbacks.current = { onCommand, onNotice };
  const state = useRef({
    enabled: false,
    recognition: null as Recognition | null,
    utterance: null as SpeechSynthesisUtterance | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  const releaseRecognition = useCallback(() => {
    const session = state.current;
    clearTimeout(session.timer);
    const recognition = session.recognition;
    session.recognition = null;
    recognition?.abort();
  }, []);

  const stop = useCallback(() => {
    const session = state.current;
    session.enabled = false;
    releaseRecognition();
    if (session.utterance) {
      session.utterance = null;
      window.speechSynthesis.cancel();
    }
    setEnabled(false);
  }, [releaseRecognition]);

  const listen = useCallback(function listen() {
    const session = state.current;
    if (!session.enabled || session.utterance || session.recognition) return;
    if (document.hidden || document.querySelector(interviewSelector)) {
      stop();
      return;
    }
    const RecognitionClass = recognitionConstructor();
    if (!RecognitionClass) return;

    try {
      const recognition = new RecognitionClass();
      recognition.lang = document.documentElement.lang || 'en';
      let transcript = '';
      session.recognition = recognition;
      recognition.onresult = event => {
        transcript = event.results[0]?.[0]?.transcript ?? '';
      };
      recognition.onerror = ({ error }) => {
        if (session.recognition !== recognition || error === 'no-speech') return;
        stop();
        callbacks.current.onNotice(error === 'not-allowed' || error === 'service-not-allowed'
          ? 'Microphone access was blocked. Check your browser permissions or type a command.'
          : 'Speech recognition stopped. You can restart it or type a command.');
      };
      recognition.onend = () => {
        if (session.recognition !== recognition) return;
        session.recognition = null;
        if (transcript) callbacks.current.onCommand(transcript);
        clearTimeout(session.timer);
        if (session.enabled && !session.utterance) session.timer = setTimeout(listen, 300);
      };
      recognition.start();
    } catch {
      stop();
      callbacks.current.onNotice('Could not start the microphone. You can type commands below.');
    }
  }, [stop]);

  const start = useCallback(() => {
    if (document.querySelector(interviewSelector)) {
      callbacks.current.onNotice('The interview is using the microphone. You can type commands below.');
      return;
    }
    state.current.enabled = true;
    setEnabled(true);
    callbacks.current.onNotice('Listening for commands.');
    listen();
  }, [listen]);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window) || document.querySelector(interviewSelector)) return;
    const session = state.current;
    releaseRecognition();
    if (session.utterance) {
      session.utterance = null;
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || 'en';
    session.utterance = utterance;
    utterance.onend = utterance.onerror = () => {
      if (session.utterance !== utterance) return;
      session.utterance = null;
      if (session.enabled) session.timer = setTimeout(listen, 300);
    };
    window.speechSynthesis.speak(utterance);
  }, [listen, releaseRecognition]);

  useEffect(() => {
    setSupported(Boolean(window.isSecureContext && recognitionConstructor()));
    function pauseForInterview() {
      const wasListening = state.current.enabled;
      stop();
      if (wasListening) callbacks.current.onNotice('Voice commands paused so the interview can use the microphone.');
    }
    function onVisibilityChange() {
      if (document.hidden) stop();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(interviewMicrophoneEvent, pauseForInterview);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(interviewMicrophoneEvent, pauseForInterview);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [stop]);

  return { supported, enabled, start, stop, speak };
}
