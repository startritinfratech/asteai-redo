'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { choicesFor, findControl, getControls, parseCommand, prepareValue, setControlValue, type Control } from './controls';
import { interviewMicrophoneEvent, useSpeechCommands } from './useSpeechCommands';
import styles from './voice.module.css';

type PendingAction = { control: Control; url: string; expires: number };
const confirmationTime = 30_000;

export function VoiceControl() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('Say or type “show controls” to get started.');
  const [controls, setControls] = useState<Control[]>([]);
  const [confirming, setConfirming] = useState(false);
  const controlIds = useRef(new WeakMap<HTMLElement, number>());
  const nextId = useRef(0);
  const pending = useRef<PendingAction | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  function scan() {
    return getControls(controlIds.current, () => ++nextId.current);
  }

  function clearPending() {
    pending.current = null;
    clearTimeout(timeout.current);
    setConfirming(false);
  }

  const speech = useSpeechCommands(command => run(command, true), setNotice);

  function run(transcript: string, spoken = false) {
    const command = parseCommand(transcript);
    const respond = (message: string) => {
      setNotice(message);
      if (spoken) speech.speak(message);
    };

    if (command.type === 'confirm') {
      const action = pending.current;
      clearPending();
      if (!action || action.expires < Date.now()) return respond('There is no action to confirm.');
      const current = scan().find(control => control.id === action.control.id);
      if (!current || current.element !== action.control.element ||
          current.label !== action.control.label || current.destination !== action.control.destination ||
          window.location.href !== action.url) {
        return respond('That control changed. Ask for it again.');
      }
      current.element.click();
      setNotice(`Activated ${current.label}.`);
      return;
    }

    clearPending();
    switch (command.type) {
      case 'cancel': return respond('Cancelled.');
      case 'stop':
        speech.stop();
        setNotice('Microphone off.');
        return;
      case 'help':
        setControls(scan());
        return respond('Say “read controls” for names and numbers, then “activate” and a control number. To fill a field, say “set” and the field name, followed by “to” and the value.');
      case 'readControls': {
        const current = scan();
        setControls(current);
        const message = current.slice(0, 24).map(control => `${control.id}. ${control.label}.`).join(' ');
        const suffix = current.length > 24 ? ' More controls are listed in the panel.' : '';
        const description = message ? message + suffix : 'No available controls on this page.';
        setNotice(description);
        speech.speak(description);
        return;
      }
      case 'readPage': {
        const page = document.querySelector<HTMLElement>('main, [role="main"]') ?? document.querySelector<HTMLElement>('h1');
        const text = page?.innerText.trim();
        if (!text) return respond('There is no page text to read.');
        const reading = text.length > 750 ? `${text.slice(0, 750).trim()}…` : text;
        setNotice(reading);
        speech.speak(reading);
        return;
      }
      case 'scroll': {
        const main = document.querySelector('main');
        const scroller = main && /auto|scroll/.test(getComputedStyle(main).overflowY) ? main : window;
        scroller.scrollBy(0, command.direction * Math.round(window.innerHeight * 0.7));
        setNotice(command.direction > 0 ? 'Scrolled down.' : 'Scrolled up.');
        return;
      }
      case 'back':
        window.history.back();
        setNotice('Going back.');
        return;
      case 'unknown':
        return respond('Command not recognised. Say “help” for examples.');
    }

    const current = scan();
    setControls(current);
    const matches = findControl(current, command.target);
    if (matches.length === 0) return respond('That control is unavailable. Try “read controls”.');
    if (matches.length > 1) return respond(`More than one control matches. Use number ${matches.map(control => control.id).join(' or ')}.`);
    const [control] = matches;

    if (command.type === 'activate') {
      if (control.kind !== 'action') {
        control.element.focus();
        return respond(`Focused ${control.label}. Say “set” followed by the field name, “to”, and the value.`);
      }
      pending.current = { control, url: window.location.href, expires: Date.now() + confirmationTime };
      setConfirming(true);
      timeout.current = setTimeout(() => {
        clearPending();
        setNotice('Confirmation expired.');
      }, confirmationTime);
      return respond(`Activate ${control.label}? Say “confirm” or “cancel”.`);
    }

    if (command.type === 'focus') {
      control.element.focus();
      return respond(`Focused ${control.label}.`);
    }

    if (command.type === 'choices') {
      const choices = choicesFor(control).map(option => option.label).join(', ');
      return respond(choices ? `Choices for ${control.label}. ${choices}.` : 'That control has no selectable options.');
    }

    if (command.type === 'set') {
      const value = prepareValue(control, command.value);
      if (value === null) return respond('That value does not match this field. Try “choices for” followed by its name if it is a list.');
      setControlValue(control, value);
      return respond(`Updated ${control.label}.`);
    }
  }

  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      const next = getControls(controlIds.current, () => ++nextId.current);
      setControls(previous => previous.length === next.length && previous.every((control, index) =>
        control.element === next[index].element && control.label === next[index].label &&
        control.kind === next[index].kind && control.destination === next[index].destination,
      ) ? previous : next);
    };
    let frame = 0;
    const observer = new MutationObserver(records => {
      const outsidePanel = records.some(({ target }) => {
        const element = target instanceof Element ? target : target.parentElement;
        return !element?.closest('[data-voice-ignore]');
      });
      if (outsidePanel && !frame) frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    });
    refresh();
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'aria-hidden', 'aria-disabled', 'aria-modal',
        'disabled', 'hidden', 'href', 'inert', 'open', 'readonly', 'type', 'class'],
    });
    window.addEventListener('resize', refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    function discardAction() {
      pending.current = null;
      clearTimeout(timeout.current);
      setConfirming(false);
    }
    function onVisibilityChange() {
      if (document.hidden) discardAction();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(interviewMicrophoneEvent, discardAction);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(interviewMicrophoneEvent, discardAction);
      clearTimeout(timeout.current);
    };
  }, []);

  function toggle() {
    if (open) {
      speech.stop();
      clearPending();
      setNotice('Microphone off.');
    }
    setOpen(!open);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;
    run(input);
    setInput('');
  }

  return (
    <aside className={styles.widget} aria-label="Voice control" data-voice-ignore>
      <button type="button" className={styles.launch} aria-expanded={open} aria-controls="asteai-voice-panel" onClick={toggle}>
        {speech.enabled ? 'Voice on' : 'Voice control'}
      </button>
      <div id="asteai-voice-panel" className={styles.panel} hidden={!open}>
        <p>Your browser may send audio to its speech service. Speak or type commands in English.</p>
        <button type="button" onClick={speech.enabled ? () => run('stop listening') : speech.start} disabled={!speech.supported}>
          {speech.enabled ? 'Stop listening' : 'Start listening'}
        </button>
        {!speech.supported && <p>Speech recognition is unavailable here. You can still type commands.</p>}
        <form className={styles.form} onSubmit={submit}>
          <input aria-label="Type a voice command" placeholder="e.g. show controls" autoComplete="off"
            value={input} onChange={event => setInput(event.target.value)} />
          <button type="submit">Run</button>
        </form>
        <p className={styles.notice} role="status">{notice}</p>
        {confirming && <div className={styles.form}>
          <button type="button" onClick={() => run('confirm')}>Confirm action</button>
          <button type="button" onClick={() => run('cancel')}>Cancel action</button>
        </div>}
        <details open>
          <summary>Available controls ({controls.length})</summary>
          <ul className={styles.controls}>
            {controls.map(control => <li key={control.id}>{control.id}. {control.label}</li>)}
          </ul>
        </details>
        <details>
          <summary>Command examples</summary>
          <p>“Activate number 4”, “set email to …”, “choices for language”, “read page”, “scroll down”, “go back”, “stop listening”.</p>
        </details>
      </div>
    </aside>
  );
}
