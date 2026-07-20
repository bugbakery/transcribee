import { BlobReader, BlobWriter, Entry, ZipReader } from '@zip.js/zip.js';
import { parseTarHeader, roundToNextBlock, TAR_BLOCK_SIZE } from 'transcribee-ui-common/utils/tar';

export async function loadTranscribeeArchive(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<[Blob | null | undefined, Blob | null | undefined]> {
  let automergeFile, mediaFile;
  if (new TextDecoder().decode(bytes.subarray(257, 257 + 5)) == 'ustar') {
    // we are dealing with the new tar based transcribee archive format
    let offset = 0;
    while (offset + TAR_BLOCK_SIZE < bytes.length) {
      const header = parseTarHeader(bytes.subarray(offset, offset + TAR_BLOCK_SIZE));
      offset += TAR_BLOCK_SIZE;
      if (header.path == 'media') {
        mediaFile = new Blob([bytes.subarray(offset, offset + header.size)]);
      } else if (header.path == 'document.automerge') {
        automergeFile = new Blob([bytes.subarray(offset, offset + header.size)]);
      }
      offset = roundToNextBlock(offset + header.size);
    }
  } else {
    // we are dealing with the old zip based transcribee archive format
    const zipReader = new ZipReader(new BlobReader(new Blob([bytes])));
    const entries = await zipReader.getEntries();
    [automergeFile, mediaFile] = await Promise.all([
      getZipEntry(zipReader, entries, 'document.automerge'),
      getZipEntry(zipReader, entries, 'media'),
    ]);
  }
  return [automergeFile, mediaFile];
}

async function getZipEntry(
  reader: ZipReader<BlobReader>,
  entries: Entry[],
  name: string,
): Promise<Blob | null> {
  for (const entry of entries) {
    if (entry.filename == name) {
      const writer = new BlobWriter();
      const data = entry.directory == false ? await entry.getData(writer) : null;
      return data;
    }
  }
  return null;
}
