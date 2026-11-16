import { audioContext } from "./audio";
export function clean(
  buffer: AudioBuffer,
  strength: number,
  progress: (p: number) => void,
  signal?: AbortSignal,
  noiseProfileSeconds = 0,
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Processing cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./noise.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Processing cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      finish();
      reject(
        new Error(
          e.message || "Noise reduction failed. Your originals are safe.",
        ),
      );
    };
    worker.onmessage = (e) => {
      if (e.data.error) {
        finish();
        reject(new Error(e.data.error));
      } else if (e.data.channels) {
        const output = audioContext().createBuffer(
          buffer.numberOfChannels,
          buffer.length,
          buffer.sampleRate,
        );
        e.data.channels.forEach((data: Float32Array, c: number) =>
          output.copyToChannel(data, c),
        );
        finish();
        resolve(output);
      } else progress(e.data.progress);
    };
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c).slice(),
    );
    worker.postMessage(
      {
        channels,
        sampleRate: buffer.sampleRate,
        strength,
        noiseProfileSeconds,
      },
      channels.map((c) => c.buffer),
    );
  });
}
