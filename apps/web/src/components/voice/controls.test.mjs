import { expect, test } from 'bun:test';
import { findControl, parseCommand } from './controls';

test('dictation preserves punctuation and mixed case in field values', () => {
  expect(parseCommand('Set skill or job title to C++ / Node.js')).toEqual({
    type: 'set', target: 'skill or job title', value: 'C++ / Node.js',
  });
});

test('only an explicit confirmation command confirms an action', () => {
  expect(parseCommand('Confirm.')).toEqual({ type: 'confirm' });
  expect(parseCommand('Yes, do it.')).toEqual({ type: 'confirm' });
  expect(parseCommand('Do not confirm')).toEqual({ type: 'unknown' });
  expect(parseCommand('Cancel')).toEqual({ type: 'cancel' });
});

test('polite requests can navigate or fill a field without changing its value', () => {
  expect(parseCommand('Hey AsteAI, can you please take me to the interview studio?')).toEqual({
    type: 'navigate', target: 'the interview studio?',
  });
  expect(parseCommand('Could you fill skill or job title with C++ / Node.js')).toEqual({
    type: 'set', target: 'skill or job title', value: 'C++ / Node.js',
  });
});

test('navigation aliases resolve only a link already available on the page', () => {
  const studio = { id: 3, label: 'AI Interview Studio', destination: 'https://example.test/platform/studio' };
  expect(findControl([studio], 'the interview studio', true)).toEqual([studio]);
  expect(findControl([studio], 'the interview studio')).toEqual([]);
  expect(findControl([{ ...studio, destination: null }], 'the interview studio', true)).toEqual([]);
});

test('duplicate labels require a control number and partial labels do not match', () => {
  const controls = [
    { id: 3, label: 'Download' },
    { id: 21, label: 'Download' },
    { id: 22, label: 'Download certificate' },
  ];
  expect(findControl(controls, 'download')).toEqual(controls.slice(0, 2));
  expect(findControl(controls, 'number twenty-one')).toEqual([controls[1]]);
  expect(findControl(controls, 'down')).toEqual([]);
});
