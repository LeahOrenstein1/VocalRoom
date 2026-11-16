import {
  audioContext,
  duration,
  renderMix,
  type Track,
  type Mix,
} from "./audio";
import { clean } from "./noise-client";
import type {
  SignalAnalysis,
  VocalPlan,
  ProductionReport,
  MasterReport,
} from "./studio-dsp";
import type { ProcessedMix, ProcessingProgress } from "./processing";
const clamp = (x: number, min: number, max: number) =>
  Math.min(max, Math.max(min, x));
function audioTask<T>(
  task: string,
  buffer: AudioBuffer,
  options: Record<string, unknown>,
  signal?: AbortSignal,
  progress?: (p: number) => void,
  trim?: [number, number],
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Processing cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./studio.worker.ts", import.meta.url), {
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
          e.message || "Studio processing failed. Choose Classic DSP to retry.",
        ),
      );
    };
    worker.onmessage = ({ data }) => {
      if (data.error) {
        finish();
        reject(new Error(data.error));
      } else if (data.result) {
        finish();
        resolve(data.result);
      } else progress?.(data.progress);
    };
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer
        .getChannelData(c)
        .slice(trim?.[0] ?? 0, trim?.[1] ?? buffer.length),
    );
    worker.postMessage(
      { task, channels, sampleRate: buffer.sampleRate, ...options },
      channels.map((c) => c.buffer),
    );
  });
}
function fromPcm(channels: Float32Array[], rate: number) {
  const buffer = audioContext().createBuffer(
    channels.length,
    channels[0].length,
    rate,
  );
  channels.forEach((c, i) => buffer.copyToChannel(c, i));
  return buffer;
}
export async function processStudioSession(
  tracks: Track[],
  mix: Mix,
  onProgress: (p: ProcessingProgress) => void,
  signal: AbortSignal | undefined,
  signature: string,
): Promise<ProcessedMix> {
  const report = async (
    stage: ProcessingProgress["stage"],
    progress: number,
    detail: string,
  ) => {
    if (signal?.aborted)
      throw new DOMException("Processing cancelled", "AbortError");
    onProgress({ stage, progress, detail });
    await new Promise((r) => setTimeout(r, 0));
  };
  const solo = tracks.some((t) => t.solo),
    audible = tracks.filter((t) => !t.mute && (!solo || t.solo)),
    vocals = audible.filter((t) => t.kind === "vocal");
  const analyses = new Map<string, SignalAnalysis>(),
    plans = new Map<string, VocalPlan>();
  await report(
    "analysis",
    0.02,
    "Measuring vocal dynamics, spectral balance, and accompaniment",
  );
  for (let i = 0; i < audible.length; i++) {
    const t = audible[i];
    analyses.set(
      t.id,
      await audioTask<SignalAnalysis>(
        "analyze",
        t.buffer,
        {},
        signal,
        undefined,
        [
          Math.round(t.trimStart * t.buffer.sampleRate),
          Math.round(t.trimEnd * t.buffer.sampleRate),
        ],
      ),
    );
    await report(
      "analysis",
      0.02 + (0.12 * (i + 1)) / audible.length,
      `Analyzed ${t.name}`,
    );
  }
  const buffers = new Map<string, AudioBuffer>();
  for (let i = 0; i < vocals.length; i++) {
    const t = vocals[i];
    let buffer = t.buffer;
    if (
      (mix.noiseReduction ?? 0.65) > 0 &&
      (analyses.get(t.id)?.rms ?? 0) > 1e-8
    ) {
      await report(
        "noise",
        0.16 + (0.27 * i) / vocals.length,
        `Reducing room noise · ${t.name}`,
      );
      buffer = await clean(
        buffer,
        mix.noiseReduction ?? 0.65,
        (p) =>
          onProgress({
            stage: "noise",
            progress: 0.16 + (0.27 * (i + p)) / vocals.length,
            detail: `Reducing room noise · ${t.name}`,
          }),
        signal,
        t.noiseProfileSeconds ?? 0,
      );
    }
    buffers.set(t.id, buffer);
  }
  for (let i = 0; i < vocals.length; i++) {
    const t = vocals[i],
      buffer = buffers.get(t.id)!;
    await report(
      "vocal",
      0.45 + (0.18 * i) / vocals.length,
      `Shaping dynamics, harshness, and sibilance · ${t.name}`,
    );
    const analysis = await audioTask<SignalAnalysis>(
      "analyze",
      buffer,
      {},
      signal,
      undefined,
      [
        Math.round(t.trimStart * buffer.sampleRate),
        Math.round(t.trimEnd * buffer.sampleRate),
      ],
    );
    analyses.set(t.id, analysis);
    const result = await audioTask<{
      channels: Float32Array[];
      plan: VocalPlan;
    }>(
      "vocal",
      buffer,
      { analysis, preset: mix.preset, intensity: mix.intensity },
      signal,
      (p) =>
        onProgress({
          stage: "vocal",
          progress: 0.45 + (0.18 * (i + p)) / vocals.length,
          detail: `Shaping dynamics, harshness, and sibilance · ${t.name}`,
        }),
    );
    buffers.set(t.id, fromPcm(result.channels, buffer.sampleRate));
    plans.set(t.id, result.plan);
  }
  await report(
    "balance",
    0.65,
    "Finding vocal placement and reducing masking only where needed",
  );
  const auto = mix.autoMix ?? true,
    backs = audible.filter((t) => t.kind === "backing");
  let voiceEnergy = 0,
    backEnergy = 0,
    mask = 0;
  for (const t of vocals) {
    const a = analyses.get(t.id)!,
      p = plans.get(t.id)!;
    voiceEnergy += (a.activeRms * 10 ** (p.staticGainDb / 20) * t.volume) ** 2;
  }
  for (const t of backs)
    backEnergy += ((analyses.get(t.id)?.activeRms ?? 0) * t.volume) ** 2;
  if (auto && vocals.length && backs.length) {
    const vp =
        vocals.reduce((s, t) => s + analyses.get(t.id)!.bands.presence, 0) /
        vocals.length,
      bp =
        backs.reduce((s, t) => s + analyses.get(t.id)!.bands.presence, 0) /
        backs.length;
    mask = (clamp(Math.min(vp, bp) - 0.06, 0, 0.3) / 0.3) * 2 * mix.intensity;
  }
  const voiceScale =
    auto && voiceEnergy > 0
      ? clamp(0.14 / Math.sqrt(voiceEnergy), 0.75, 1.25)
      : 1;
  const backingTarget =
    voiceEnergy > 0 ? Math.sqrt(voiceEnergy) * voiceScale * 0.85 : 0.18;
  const backScale =
    auto && backEnergy > 0
      ? clamp(backingTarget / Math.sqrt(backEnergy), 0.5, 1.1)
      : 1;
  const hop = 0.05,
    curve = new Float32Array(
      Math.max(2, Math.ceil((duration(tracks) + 2) / hop) + 1),
    );
  let envelope = 0;
  for (let f = 0; f < curve.length; f++) {
    let activity = 0;
    for (const t of vocals) {
      const a = analyses.get(t.id)!,
        time = f * hop - t.offset,
        index = Math.floor(time / a.hopSeconds);
      if (index >= 0 && index < a.activity.length)
        activity = Math.max(
          activity,
          clamp(
            (a.activity[index] / Math.max(0.0001, a.activeRms) - 0.1) / 0.8,
            0,
            1,
          ),
        );
    }
    const smoothing = activity > envelope ? 0.3 : 0.12;
    envelope += smoothing * (activity - envelope);
    curve[f] = -mask * envelope;
  }
  const prepared = tracks.map((t) => ({
    ...t,
    buffer: buffers.get(t.id) ?? t.buffer,
    volume: t.volume * (t.kind === "vocal" ? voiceScale : backScale),
    ...(t.kind === "vocal" && plans.has(t.id)
      ? {
          production: {
            reverb: mix.intensity * (mix.preset === "Natural" ? 0.06 : 0.11),
            delay: mix.stereoDelay ? mix.intensity * 0.045 : 0,
          },
        }
      : {}),
    ...(t.kind === "backing" && mask > 0.05
      ? { masking: { curve, hopSeconds: hop, frequency: 2800 } }
      : {}),
  }));
  await report(
    "render",
    0.72,
    "Rendering the vocal, natural ambience, and backing together",
  );
  const rendered = await renderMix(prepared, { ...mix, enabled: true });
  await report(
    "master",
    0.84,
    "Measuring loudness and protecting linked stereo peaks",
  );
  const mastered = await audioTask<{
    channels: Float32Array[];
    report: MasterReport;
  }>("master", rendered, {}, signal, (p) =>
    onProgress({
      stage: "master",
      progress: 0.84 + 0.1 * p,
      detail: "Normalizing loudness and protecting stereo peaks",
    }),
  );
  const buffer = fromPcm(mastered.channels, rendered.sampleRate);
  await report(
    "master",
    0.96,
    "Preparing a level-matched original / processed comparison",
  );
  const original = await renderMix(tracks, { ...mix, enabled: false });
  const originalAnalysis = await audioTask<SignalAnalysis>(
    "analyze",
    original,
    {},
    signal,
  );
  const dry = originalAnalysis.lufsEstimate,
    wet = mastered.report.outputLufsEstimate,
    delta = dry === null || wet === null ? 0 : clamp(wet - dry, -24, 24);
  const details: ProductionReport = {
    engine: "studio-v1",
    vocals: vocals.map((t) => ({
      id: t.id,
      analysis: analyses.get(t.id)!,
      plan: plans.get(t.id)!,
    })),
    maskingCutDb: mask,
    master: mastered.report,
    originalComparisonGain: Math.min(1, 10 ** (delta / 20)),
    processedComparisonGain: Math.min(1, 10 ** (-delta / 20)),
  };
  await report(
    "ready",
    1,
    "Your studio mix is ready. Originals remain unchanged.",
  );
  return { buffer, signature, report: details };
}
