import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, numDataCodewords, rsDivisor, rsRemainder } from './qr';

/**
 * Reads a matrix produced by encodeQr back to text, independently of the encoder's
 * internals except for the standard's layout rules: format bits, unmasking, the zigzag
 * codeword order, de-interleaving and the byte-mode header. Also checks the RS parity.
 */
function decode(m: boolean[][]): { text: string; version: number; ecl: number; mask: number } {
  const size = m.length;
  const version = (size - 17) / 4;

  // Format bits, first copy (around the top-left finder).
  let fmt = 0;
  const coords: [number, number][] = [];
  for (let i = 0; i <= 5; i += 1) coords.push([8, i]);
  coords.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i += 1) coords.push([14 - i, 8]);
  coords.forEach(([x, y], i) => { if (m[y][x]) fmt |= 1 << i; });
  // Second copy must agree.
  let fmt2 = 0;
  for (let i = 0; i < 8; i += 1) if (m[8][size - 1 - i]) fmt2 |= 1 << i;
  for (let i = 8; i < 15; i += 1) if (m[size - 15 + i][8]) fmt2 |= 1 << i;
  assert.equal(fmt2, fmt, 'both format copies agree');
  const unmasked = fmt ^ 0x5412;
  const data5 = unmasked >>> 10;
  let rem = data5;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((data5 << 10) | rem) >>> 0, unmasked, 'format BCH is valid');
  const ecl = data5 >>> 3;
  const mask = data5 & 7;
  assert.ok(m[size - 8][8], 'dark module');

  // Function-module map from the standard's layout.
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  }
  if (version > 1) {
    const n = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((a, i) => pos.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(a + dx, b + dy);
    }));
  }
  for (let i = 0; i < 9; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (version >= 7) for (let i = 0; i < 18; i += 1) { mark(size - 11 + (i % 3), Math.floor(i / 3)); mark(Math.floor(i / 3), size - 11 + (i % 3)); }

  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0, (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask];

  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) bits.push((m[y][x] !== maskFn(x, y)) ? 1 : 0);
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // De-interleave (level M tables come from the encoder's capacity function).
  const raw = codewords.length;
  const dataLen = numDataCodewords(version);
  const eccTotal = raw - dataLen;
  const numBlocks = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5][version];
  const eccLen = eccTotal / numBlocks;
  const shortData = Math.floor(dataLen / numBlocks);
  const numLong = dataLen % numBlocks;
  const blocks = Array.from({ length: numBlocks }, (_, b) => ({ data: [] as number[], ecc: [] as number[], len: shortData + (b >= numBlocks - numLong ? 1 : 0) }));
  let k = 0;
  for (let i = 0; i < shortData + 1; i += 1) blocks.forEach((b) => { if (i < b.len) b.data.push(codewords[k++]); });
  for (let i = 0; i < eccLen; i += 1) blocks.forEach((b) => b.ecc.push(codewords[k++]));
  const divisor = rsDivisor(eccLen);
  blocks.forEach((b) => assert.deepEqual(rsRemainder(b.data, divisor), b.ecc, 'RS parity matches'));

  const data = blocks.flatMap((b) => b.data);
  const dbits = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  const read = (from: number, len: number) => parseInt(dbits.slice(from, from + len).join(''), 2);
  assert.equal(read(0, 4), 0b0100, 'byte mode');
  const ccBits = version <= 9 ? 8 : 16;
  const count = read(4, ccBits);
  const bytes = Array.from({ length: count }, (_, i) => read(4 + ccBits + i * 8, 8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version, ecl, mask };
}

describe('QR encoder', () => {
  it('has the standard level-M data capacities', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(numDataCodewords), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
  });

  it('computes Reed–Solomon parity (ISO 18004 / Thonky 1-M example)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    assert.deepEqual(rsRemainder(data, rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('draws finder and timing patterns', () => {
    const m = encodeQr('hello');
    assert.equal(m.length, 21);
    const finderRow = [true, true, true, true, true, true, true, false];
    assert.deepEqual(m[0].slice(0, 8), finderRow);
    assert.deepEqual(m[2].slice(0, 8), [true, false, true, true, true, false, true, false]);
    for (let i = 8; i < 13; i += 1) assert.equal(m[6][i], i % 2 === 0);
  });

  for (const text of [
    'hello',
    'otpauth://totp/AsteAI:priya%40hospital.in?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AsteAI&algorithm=SHA1&digits=6&period=30',
    'x'.repeat(200),
  ]) {
    it(`round-trips ${text.length} bytes`, () => {
      const decoded = decode(encodeQr(text));
      assert.equal(decoded.text, text);
      assert.equal(decoded.ecl, 0, 'level M');
    });
  }
});
