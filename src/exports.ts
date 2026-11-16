import { duration, type Track } from "./audio";
/** Dry, timeline-aligned stems: source edits/faders only, no effects, compressor or reverb. */
export async function renderDryStem(tracks: Track[], kind: Track["kind"]) {
  const solo = tracks.some((t) => t.solo),
    selected = tracks.filter(
      (t) => t.kind === kind && !t.mute && (!solo || t.solo),
    );
  if (!selected.length)
    throw new Error(
      `No audible ${kind === "vocal" ? "vocal" : "backing"} tracks. Check Mute and Solo.`,
    );
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(duration(tracks) * 44100),
    44100,
  );
  for (const t of selected) {
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    source.buffer = t.buffer;
    gain.gain.value = t.volume;
    pan.pan.value = t.pan;
    source.connect(gain);
    gain.connect(pan);
    pan.connect(ctx.destination);
    const start = t.trimStart + Math.max(0, -t.offset),
      remaining = t.trimEnd - start;
    if (remaining > 0) source.start(Math.max(0, t.offset), start, remaining);
  }
  const buffer = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < 2; c++)
    for (const x of buffer.getChannelData(c))
      peak = Math.max(peak, Math.abs(x));
  if (peak > 0.98)
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= 0.98 / peak;
    }
  return buffer;
}
export function encodeMp3(
  buffer: AudioBuffer,
  progress?: (p: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("/mp3.worker.js", window.location.origin),
      {
        type: "module",
      },
    );
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "MP3 encoding failed. Try WAV export."));
    };
    worker.onmessage = ({ data }) => {
      if (data.error) {
        worker.terminate();
        reject(new Error(data.error));
      } else if (data.bytes) {
        worker.terminate();
        resolve(new Blob([data.bytes], { type: "audio/mpeg" }));
      } else progress?.(data.progress);
    };
    const channels = Array.from(
      { length: Math.min(2, buffer.numberOfChannels) },
      (_, c) => buffer.getChannelData(c).slice(),
    );
    worker.postMessage(
      { channels, sampleRate: buffer.sampleRate },
      channels.map((c) => c.buffer),
    );
  });
}
