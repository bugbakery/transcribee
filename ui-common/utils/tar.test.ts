import { concatArrays, formatTarHeader, parseTarHeader, TAR_BLOCK_SIZE } from './tar';
import { expect, test } from 'vitest';

test('roundtrip tar header', () => {
  const initial_header = { path: '/some/random/path', size: 42 };
  const formatted = formatTarHeader(initial_header);
  expect(formatted.byteLength).toEqual(TAR_BLOCK_SIZE);
  const parsed = parseTarHeader(formatted);
  expect(parsed).toEqual(initial_header);
});

test('concat arrays', () => {
  const result = concatArrays(new Uint8Array([0]), new Uint8Array([1]), new Uint8Array([2]));

  expect(result.at(1 * TAR_BLOCK_SIZE)).toEqual(1);
  expect(result.at(2 * TAR_BLOCK_SIZE)).toEqual(2);
});
