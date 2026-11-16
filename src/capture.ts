export interface PcmCapture {
  start(when: number): void;
  stop(when?: number): Promise<AudioBuffer>;
  dispose(): void;
}
const modules = new WeakMap<AudioContext, Promise<void>>();
export async function createPcmCapture(
  ctx: AudioContext,
  stream: MediaStream,
): Promise<PcmCapture> {
  if (!ctx.audioWorklet)
    throw new Error(
      "Sample-accurate recording needs a recent Chrome browser on localhost or HTTPS.",
    );
  let module = modules.get(ctx);
  if (!module) {
    module = ctx.audioWorklet.addModule(
      new URL("./capture.worklet.js", import.meta.url).href,
    );
    modules.set(ctx, module);
    module.catch(() => modules.delete(ctx));
  }
  await module;
  const input = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "vocalroom-pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const silent = ctx.createGain();
  silent.gain.value = 0;
  input.connect(node);
  node.connect(silent);
  silent.connect(ctx.destination);
  const chunks: Float32Array[] = [];
  let resolveStop: ((buffer: AudioBuffer) => void) | undefined,
    rejectStop: ((error: Error) => void) | undefined;
  let promise: Promise<AudioBuffer> | undefined,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    input.disconnect();
    node.disconnect();
    silent.disconnect();
    node.port.postMessage({ type: "dispose" });
    node.port.close();
  };
  node.onprocessorerror = () => {
    rejectStop?.(
      new Error("Audio capture failed. Check the microphone and retry."),
    );
    dispose();
  };
  node.port.onmessage = ({ data }) => {
    if (data.type === "samples") chunks.push(data.samples);
    if (data.type === "stopped") {
      if (data.frames === 0) {
        rejectStop?.(
          new Error(
            "The recording was empty. Record a little longer and retry.",
          ),
        );
        dispose();
        return;
      }
      const buffer = ctx.createBuffer(1, data.frames, ctx.sampleRate),
        samples = buffer.getChannelData(0);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      resolveStop?.(buffer);
      dispose();
    }
  };
  return {
    start(when) {
      node.port.postMessage({
        type: "start",
        frame: Math.round(when * ctx.sampleRate),
      });
    },
    stop(when = ctx.currentTime) {
      if (promise) return promise;
      promise = new Promise<AudioBuffer>((resolve, reject) => {
        resolveStop = resolve;
        rejectStop = reject;
      });
      if (disposed) {
        rejectStop?.(new Error("Capture is no longer available."));
        return promise;
      }
      node.port.postMessage({
        type: "stop",
        frame: Math.round(when * ctx.sampleRate),
      });
      return promise;
    },
    dispose() {
      rejectStop?.(new Error("Capture cancelled."));
      dispose();
    },
  };
}
export function estimatedDelayMs(ctx: AudioContext, stream: MediaStream) {
  const settings = stream.getAudioTracks()[0]?.getSettings() as
    (MediaTrackSettings & { latency?: number }) | undefined;
  return Math.round(
    Math.min(
      1,
      Math.max(
        0,
        (ctx.baseLatency || 0) +
          (ctx.outputLatency || 0) +
          (settings?.latency || 0),
      ),
    ) * 1000,
  );
}
