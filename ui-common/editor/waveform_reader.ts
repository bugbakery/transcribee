export class WaveformReader {
  version: number;
  bytesPerSample: number;
  sampleRate: number;
  samplesPerPixel: number;
  length: number;
  channels: number;
  buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    const dv = new DataView(buffer);

    // we use BBC's audiowaveform data file format.
    // see: https://codeberg.org/chrisn/audiowaveform/src/commit/c043aed7bd78224543e238e37c38fd833fc50815/doc/DataFormat.md

    this.version = dv.getInt32(0, true);
    const flags = dv.getUint32(4, true);
    this.bytesPerSample = flags & 0x1 ? 1 : 2;
    this.sampleRate = dv.getInt32(8, true);
    this.samplesPerPixel = dv.getInt32(12, true);
    this.length = dv.getUint32(16, true);
    if (this.version >= 2) {
      this.channels = dv.getInt32(20, true);
    } else {
      this.channels = 1;
    }
  }

  getDataIter() {
    const dv = new DataView(this.buffer, 24);
    const channels = this.channels;
    const length = this.length;

    if (this.bytesPerSample == 2) {
      return (function* () {
        for (let i = 0; i < length / channels; i++) {
          yield dv.getInt16((i * channels * 2 + 0) * 2, true);
          yield dv.getInt16((i * channels * 2 + 1) * 2, true);
        }
      })();
    } else if (this.bytesPerSample == 1) {
      return (function* () {
        for (let i = 0; i < length / channels; i++) {
          yield dv.getInt8(i * channels * 2 + 0);
          yield dv.getInt8(i * channels * 2 + 1);
        }
      })();
    } else {
      throw new Error(`Invalid state: bytesPerSample = ${this.bytesPerSample}`);
    }
  }
}
