import {
  audioContext,
  analyze,
  renderMix,
  type Track,
  type Mix,
} from "./audio";
export interface ProcessedMix {
  buffer: AudioBuffer;
  signature: string;
}
export interface ProcessingProgress {
  stage: "analysis" | "noise" | "balance" | "render" | "ready";
  progress: number;
  detail: string;
}
export function mixSignature(tracks: Track[], mix: Mix) {
  return JSON.stringify({
    tracks: tracks.map(({ buffer, ...t }) => ({
      ...t,
      length: buffer.length,
      sampleRate: buffer.sampleRate,
    })),
    preset: mix.preset,
    intensity: mix.intensity,
    noiseReduction: mix.noiseReduction ?? 0.65,
    autoMix: mix.autoMix ?? true,
  });
}
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function clean(
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
export async function processSession(
  tracks: Track[],
  mix: Mix,
  onProgress: (p: ProcessingProgress) => void,
  signal?: AbortSignal,
): Promise<ProcessedMix> {
  const report = async (
    stage: ProcessingProgress["stage"],
    progress: number,
    detail: string,
  ) => {
    if (signal?.aborted)
      throw new DOMException("Processing cancelled", "AbortError");
    onProgress({ stage, progress, detail });
    await paint();
  };
  await report("analysis", 0.02, "Analyzing vocal levels and the session");
  const vocals = tracks.filter((t) => t.kind === "vocal");
  const solo = tracks.some((t) => t.solo);
  const audible = tracks.filter((t) => !t.mute && (!solo || t.solo));
  const inputLevels = new Map(tracks.map((t) => [t.id, analyze(t.buffer)]));
  const prepared: Track[] = [];
  for (const t of tracks) {
    let buffer = t.buffer;
    if (
      t.kind === "vocal" &&
      audible.includes(t) &&
      (inputLevels.get(t.id)?.rms ?? 0) > 1e-8 &&
      (mix.noiseReduction ?? 0.65) > 0
    ) {
      const index = vocals.indexOf(t);
      await report(
        "noise",
        0.08 + (0.45 * index) / Math.max(1, vocals.length),
        `Reducing background noise · ${t.name}`,
      );
      buffer = await clean(
        t.buffer,
        mix.noiseReduction ?? 0.65,
        (p) =>
          onProgress({
            stage: "noise",
            progress: 0.08 + (0.45 * (index + p)) / Math.max(1, vocals.length),
            detail: `Reducing background noise · ${t.name}`,
          }),
        signal,
        t.noiseProfileSeconds ?? 0,
      );
    }
    prepared.push({ ...t, buffer });
  }
  await report("balance", 0.58, "Balancing vocals and accompaniment");
  // Keep user fader ratios, while establishing conservative vocal/instrumental headroom.
  const autoMix = mix.autoMix ?? true;
  let vocalEnergy = 0,
    backingEnergy = 0;
  for (const t of prepared.filter((t) => !t.mute && (!solo || t.solo))) {
    const level = analyze(t.buffer).rms * t.volume;
    if (t.kind === "vocal") vocalEnergy += level * level;
    else backingEnergy += level * level;
  }
  const vocalScale =
    autoMix && vocalEnergy > 0
      ? Math.min(1.4, 0.18 / Math.sqrt(vocalEnergy))
      : 1;
  const backingTarget = vocalEnergy > 0 ? 0.12 : 0.18;
  const backingScale =
    autoMix && backingEnergy > 0
      ? Math.min(1.15, backingTarget / Math.sqrt(backingEnergy))
      : 1;
  const balanced = prepared.map((t) => ({
    ...t,
    volume: t.volume * (t.kind === "vocal" ? vocalScale : backingScale),
  }));
  await report(
    "render",
    0.72,
    "Rendering vocal EQ, compression, reverb, and the complete mix",
  );
  const buffer = await renderMix(balanced, { ...mix, enabled: true });
  await report("ready", 1, "Your processed mix is ready to compare");
  return { buffer, signature: mixSignature(tracks, mix) };
}
