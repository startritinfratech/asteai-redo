import { expect, test } from 'bun:test';
import { findControl, parseCommand } from './controls';

test('dictation preserves punctuation and mixed case in field values', () => {
  expect(parseCommand('Set skill or job title to C++ / Node.js')).toEqual({
    type: 'set', target: 'skill or job title', value: 'C++ / Node.js',
  });
});

test('only an explicit confirmation command confirms an action', () => {
  expect(parseCommand('Confirm.')).toEqual({ type: 'confirm' });
  expect(parseCommand('Do not confirm')).toEqual({ type: 'unknown' });
  expect(parseCommand('Cancel')).toEqual({ type: 'cancel' });
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
