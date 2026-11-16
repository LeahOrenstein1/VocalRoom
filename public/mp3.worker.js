import { Mp3Encoder } from "/vendor/lamejs.js";
self.onmessage = async ({ data }) => {
  try {
    const channels = data.channels,
      encoder = new Mp3Encoder(channels.length, data.sampleRate, 192),
      parts = [];
    let bytes = 0;
    for (let offset = 0; offset < channels[0].length; offset += 1152) {
      const chunk = channels.map((c) =>
        Int16Array.from(c.subarray(offset, offset + 1152), (x) => {
          const value = Math.max(-1, Math.min(1, x));
          return Math.round(value * (value < 0 ? 32768 : 32767));
        }),
      );
      const encoded = encoder.encodeBuffer(chunk[0], chunk[1]);
      if (encoded.length) {
        const copy = new Uint8Array(encoded);
        parts.push(copy);
        bytes += copy.length;
      }
      if (offset % 115200 === 0)
        self.postMessage({ progress: offset / channels[0].length });
    }
    const last = new Uint8Array(encoder.flush());
    parts.push(last);
    bytes += last.length;
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    self.postMessage({ bytes: output.buffer }, { transfer: [output.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
