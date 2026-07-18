export type TarHeader = {
  path: string;
  size: number;
};

export const TAR_BLOCK_SIZE = 512;

function readZeroDelimitedString(buffer: Uint8Array): string {
  let nullIndex = new Uint8Array(buffer).indexOf(0);
  if (nullIndex == -1) {
    nullIndex = buffer.length - 1;
  }
  return new TextDecoder('utf-8').decode(buffer.subarray(0, nullIndex));
}

function encodeString(str: string, max_length: number): Uint8Array {
  const result = new TextEncoder().encode(str);
  if (result.length > max_length) {
    throw RangeError(
      `string '${str}' is too long (actual length: ${result.length}, allowed: ${max_length})`,
    );
  }
  return result;
}

function encodeOctalNumber(x: number, digits: number): Uint8Array {
  return encodeString(x.toString(8).padStart(digits - 1, '0') + ' ', digits);
}

export function parseTarHeader(buffer: Uint8Array): TarHeader {
  const path = readZeroDelimitedString(buffer.subarray(0, 100));
  const size = parseInt(readZeroDelimitedString(buffer.subarray(124, 124 + 12)), 8);
  return { path, size };
}

export function formatTarHeader(header: TarHeader): Uint8Array {
  const buffer = new Uint8Array(TAR_BLOCK_SIZE);
  // offsets are from https://en.wikipedia.org/w/index.php?title=Tar_(computing)&oldid=1363986389

  // path
  buffer.set(encodeString(header.path, 100), 0);
  // mode
  buffer.set(encodeOctalNumber(0, 8), 100);
  // owner
  buffer.set(encodeOctalNumber(0, 8), 108);
  // group
  buffer.set(encodeOctalNumber(0, 8), 116);
  // file size TODO: handle big files (> 8Gib)
  buffer.set(encodeOctalNumber(header.size, 12), 124);
  // mtime
  buffer.set(encodeOctalNumber(0, 12), 136);
  // checksum (will be patched later; see below)
  buffer.set(encodeString('        ', 8), 148);
  // link indicator
  buffer.set(encodeString('0', 1), 156);
  // name of linked file
  buffer.set(encodeString('', 100), 157);
  // ustar magic
  buffer.set(encodeString('ustar', 5), 257);
  // ustar version
  buffer.set(encodeString('00', 2), 263);
  // owner user name
  buffer.set(encodeString('', 32), 265);
  // owner group name
  buffer.set(encodeString('', 32), 297);
  // device major number
  buffer.set(encodeOctalNumber(0, 8), 329);
  // device minor number
  buffer.set(encodeOctalNumber(0, 8), 337);
  // filename prefix
  buffer.set(encodeString('', 155), 345);

  // update checksum
  const checksum = buffer.reduce((a, b) => a + b);
  buffer.set(encodeOctalNumber(checksum, 8), 148);

  return buffer;
}

export function roundToNextBlock(x: number): number {
  return Math.ceil(x / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

export function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  let total_size = 0;
  for (const arr of arrays) {
    total_size += roundToNextBlock(arr.length);
  }

  const buffer = new Uint8Array(total_size);
  let offset = 0;
  for (const arr of arrays) {
    buffer.set(arr, offset);
    offset += roundToNextBlock(arr.length);
  }
  return buffer;
}
