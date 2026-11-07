const selector = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"]';
const textTypes = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'range']);
const protectedAutocomplete = /(?:^|\s)(?:current-password|new-password|one-time-code|cc-\S+|transaction-\S+|webauthn)(?:\s|$)/i;

export type Control = {
  id: number;
  element: HTMLElement;
  label: string;
  kind: 'action' | 'text' | 'select';
  destination: string | null;
};

export function normalize(value: string) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function labelFor(element: HTMLElement) {
  const referenced = element.getAttribute('aria-labelledby')?.split(/\s+/)
    .map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  const labels = 'labels' in element ? Array.from(
    (element as HTMLInputElement).labels ?? [], label => {
      const copy = label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('input, textarea, select, button').forEach(control => control.remove());
      return copy.textContent?.trim();
    },
  ).join(' ') : '';
  const caption = element instanceof HTMLInputElement &&
    ['button', 'submit', 'reset'].includes(element.type) ? element.value : '';
  return [referenced, element.getAttribute('aria-label'), labels, caption,
    element.innerText, element.getAttribute('title'), element.getAttribute('placeholder')]
    .find(text => text?.trim())?.replace(/\s+/g, ' ').trim() || 'Unnamed control';
}

function available(element: HTMLElement) {
  if (!element.isConnected || element.matches(':disabled,[readonly]') ||
      element.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[data-voice-ignore]')) return false;
  if (element instanceof HTMLInputElement &&
      (['hidden', 'password', 'file'].includes(element.type) ||
        protectedAutocomplete.test(element.autocomplete))) return false;
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
}

export function getControls(ids: WeakMap<HTMLElement, number>, allocate: () => number): Control[] {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]'));
  const scope = modals.filter(available).at(-1) ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).flatMap(element => {
    if (!available(element)) return [];
    const destination = element instanceof HTMLAnchorElement ? element.href : null;
    if (destination && !/^https?:/i.test(destination)) return [];
    const kind = element instanceof HTMLSelectElement ? 'select'
      : element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && textTypes.has(element.type))
        ? 'text' : 'action';
    let id = ids.get(element);
    if (id === undefined) {
      id = allocate();
      ids.set(element, id);
    }
    return [{ id, element, label: labelFor(element), kind, destination }];
  });
}

const ones = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tens = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');

function spokenNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const small = ones.indexOf(value);
  if (small >= 0) return small;
  const [prefix, suffix, extra] = value.split(' ');
  const decade = tens.indexOf(prefix);
  const digit = suffix ? ones.indexOf(suffix) : 0;
  return decade >= 2 && digit >= 0 && digit <= 9 && !extra ? decade * 10 + digit : null;
}

export function findControl(controls: Control[], target: string) {
  const name = normalize(target);
  const number = /^(?:number|control) (.+)$/.exec(name);
  if (number) return controls.filter(control => control.id === spokenNumber(number[1]));
  const named = controls.filter(control => normalize(control.label) === name);
  return named.length ? named : controls.filter(control => control.id === spokenNumber(name));
}

export function parseCommand(transcript: string) {
  const text = transcript.trim();
  const simple = normalize(text);
  switch (simple) {
    case 'confirm': return { type: 'confirm' } as const;
    case 'cancel': return { type: 'cancel' } as const;
    case 'stop listening': return { type: 'stop' } as const;
    case 'show controls':
    case 'help': return { type: 'help' } as const;
    case 'read controls': return { type: 'readControls' } as const;
    case 'read page': return { type: 'readPage' } as const;
    case 'scroll up': return { type: 'scroll', direction: -1 } as const;
    case 'scroll down': return { type: 'scroll', direction: 1 } as const;
    case 'back':
    case 'go back': return { type: 'back' } as const;
  }
  const set = /^(?:set|choose)\s+(.+?)\s+to\s+([\s\S]+)$/i.exec(text);
  if (set) return { type: 'set', target: set[1], value: set[2] } as const;
  const action = /^(activate|click|open|go to|focus|clear|choices for)\s+(.+)$/i.exec(text);
  if (!action) return { type: 'unknown' } as const;
  const target = action[2];
  switch (action[1].toLowerCase()) {
    case 'focus': return { type: 'focus', target } as const;
    case 'clear': return { type: 'set', target, value: '' } as const;
    case 'choices for': return { type: 'choices', target } as const;
    default: return { type: 'activate', target } as const;
  }
}

export function choicesFor(control: Control) {
  if (!(control.element instanceof HTMLSelectElement)) return [];
  return Array.from(control.element.options).filter(option =>
    !option.disabled && !option.hidden && !option.closest('optgroup[disabled]'));
}

export function prepareValue(control: Control, text: string): string | null {
  if (control.kind === 'select') {
    const matches = choicesFor(control).filter(option => normalize(option.label) === normalize(text));
    return matches.length === 1 ? matches[0].value : null;
  }
  const element = control.element;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || control.kind !== 'text') return null;
  if (element.maxLength >= 0 && text.length > element.maxLength) return null;
  if (element instanceof HTMLInputElement) {
    const probe = element.cloneNode() as HTMLInputElement;
    const number = ['number', 'range'].includes(element.type) ? spokenNumber(normalize(text)) : null;
    const value = number === null || /^[-+]/.test(text) ? text : String(number);
    probe.value = value;
    if (probe.value !== value || (value && (probe.validity.rangeOverflow || probe.validity.rangeUnderflow))) return null;
    return value;
  }
  return text;
}

export function setControlValue(control: Control, value: string) {
  const element = control.element;
  // The native setter lets React detect the value change when the input event fires.
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(control.kind === 'select' ? 'change' : 'input', { bubbles: true }));
}
