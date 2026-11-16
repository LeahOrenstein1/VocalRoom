export type Preset = "Natural" | "Warm Studio" | "Pop Vocal";
export interface Track {
  id: string;
  name: string;
  kind: "backing" | "vocal";
  buffer: AudioBuffer;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  offset: number;
  trimStart: number;
  trimEnd: number;
  noiseProfileSeconds?: number;
  /** Ephemeral render settings. Source tracks are never assigned these. */
  production?: { reverb: number; delay: number };
  masking?: { curve: Float32Array; hopSeconds: number; frequency: number };
  capture?: {
    clock: "audio-context";
    sampleRate: number;
    frames: number;
    delayMs: number;
  };
}
export interface Mix {
  enabled: boolean;
  preset: Preset;
  intensity: number;
  noiseReduction?: number;
  autoMix?: boolean;
  recordingDelayMs?: number;
  engine?: "studio" | "legacy";
  stereoDelay?: boolean;
  levelMatch?: boolean;
}
let context: AudioContext;
export function audioContext() {
  return (context ??= new AudioContext());
}
export function makeTrack(
  name: string,
  buffer: AudioBuffer,
  kind: Track["kind"],
): Track {
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    buffer,
    volume: kind === "backing" ? 0.65 : 0.85,
    pan: 0,
    mute: false,
    solo: false,
    offset: 0,
    trimStart: 0,
    trimEnd: buffer.duration,
  };
}
export function duration(tracks: Track[]) {
  return Math.max(1, ...tracks.map((t) => t.offset + t.trimEnd - t.trimStart));
}
export function analyze(buffer: AudioBuffer) {
  let sum = 0,
    peak = 0;
  const a = buffer.getChannelData(0);
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
    peak = Math.max(peak, Math.abs(a[i]));
  }
  return { rms: Math.sqrt(sum / a.length), peak };
}
function impulse(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(
    2,
    Math.ceil(ctx.sampleRate * seconds),
    ctx.sampleRate,
  );
  let seed = 1327;
  for (let c = 0; c < 2; c++) {
    const a = b.getChannelData(c);
    for (let i = 0; i < a.length; i++) {
      seed = (seed * 16807) % 2147483647;
      a[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / a.length, 3);
    }
  }
  return b;
}
export function graph(
  ctx: BaseAudioContext,
  tracks: Track[],
  mix: Mix,
  destination: AudioNode,
  startAt = 0,
  seek = 0,
  comparisonGain = 1,
) {
  const sources: AudioBufferSourceNode[] = [];
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -2;
  master.knee.value = 0;
  master.ratio.value = 20;
  master.attack.value = 0.003;
  master.release.value = 0.12;
  const headroom = ctx.createGain();
  headroom.gain.value = 0.82;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 12;
  glue.ratio.value = 1.6;
  glue.attack.value = 0.03;
  glue.release.value = 0.2;
  if (mix.enabled && (mix.autoMix ?? true)) {
    headroom.connect(glue);
    glue.connect(master);
  } else headroom.connect(master);
  const output = ctx.createGain();
  master.connect(output);
  output.connect(destination);
  if (startAt > 0) {
    output.gain.setValueAtTime(0, startAt);
    output.gain.linearRampToValueAtTime(comparisonGain, startAt + 0.008);
  } else output.gain.value = comparisonGain;
  const solo = tracks.some((t) => t.solo);
  tracks
    .filter((t) => !t.mute && (!solo || t.solo))
    .forEach((t) => {
      const source = ctx.createBufferSource();
      source.buffer = t.buffer;
      const gain = ctx.createGain();
      gain.gain.value = t.volume;
      const pan = ctx.createStereoPanner();
      pan.pan.value = t.pan;
      source.connect(gain);
      let end: AudioNode = gain;
      if (t.kind === "backing" && mix.enabled && t.masking) {
        const eq = ctx.createBiquadFilter();
        eq.type = "peaking";
        eq.frequency.value = t.masking.frequency;
        eq.Q.value = 0.8;
        const curve = t.masking.curve.slice(
          Math.max(0, Math.floor(seek / t.masking.hopSeconds)),
        );
        if (curve.length > 1)
          eq.gain.setValueCurveAtTime(
            curve,
            startAt,
            (curve.length - 1) * t.masking.hopSeconds,
          );
        end.connect(eq);
        end = eq;
      }
      if (t.kind === "vocal" && mix.enabled && t.production) {
        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(ctx, mix.preset === "Pop Vocal" ? 1.4 : 1.0);
        const wet = ctx.createGain();
        wet.gain.value = t.production.reverb;
        end.connect(reverb);
        reverb.connect(wet);
        wet.connect(pan);
        if (t.production.delay > 0) {
          for (const [seconds, stereo] of [
            [0.085, -0.5],
            [0.115, 0.5],
          ]) {
            const delay = ctx.createDelay(0.3),
              level = ctx.createGain(),
              spread = ctx.createStereoPanner();
            delay.delayTime.value = seconds;
            level.gain.value = t.production.delay;
            spread.pan.value = stereo;
            end.connect(delay);
            delay.connect(level);
            level.connect(spread);
            spread.connect(headroom);
          }
        }
      } else if (t.kind === "vocal" && mix.enabled) {
        const amount = mix.intensity;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 80;
        end.connect(hp);
        const eq = ctx.createBiquadFilter();
        eq.type = "peaking";
        eq.frequency.value = mix.preset === "Warm Studio" ? 220 : 3500;
        eq.Q.value = 0.7;
        eq.gain.value = (mix.preset === "Natural" ? 1.5 : 3) * amount;
        hp.connect(eq);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12 - 12 * amount;
        comp.ratio.value = 2 + 2 * amount;
        comp.knee.value = 15;
        comp.attack.value = 0.012;
        comp.release.value = 0.18;
        eq.connect(comp);
        const auto = ctx.createGain();
        const { rms } = analyze(t.buffer);
        auto.gain.value =
          1 + (Math.min(3, 0.14 / Math.max(0.015, rms)) - 1) * amount;
        comp.connect(auto);
        end = auto;
        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(ctx, mix.preset === "Pop Vocal" ? 1.6 : 1.05);
        const wet = ctx.createGain();
        wet.gain.value = amount * (mix.preset === "Natural" ? 0.08 : 0.16);
        auto.connect(reverb);
        reverb.connect(wet);
        wet.connect(pan);
      }
      end.connect(pan);
      pan.connect(headroom);
      const timelineStart = t.offset;
      const elapsed = Math.max(0, seek - timelineStart);
      const bufferStart = t.trimStart + elapsed;
      const remaining = t.trimEnd - bufferStart;
      if (remaining > 0) {
        source.start(
          startAt + Math.max(0, timelineStart - seek),
          bufferStart,
          remaining,
        );
        sources.push(source);
      }
    });
  return (fade = 0) => {
    const end = ctx.currentTime + fade;
    if (fade > 0) {
      output.gain.cancelScheduledValues(ctx.currentTime);
      output.gain.setValueAtTime(output.gain.value, ctx.currentTime);
      output.gain.linearRampToValueAtTime(0, end);
    }
    sources.forEach((s) => {
      try {
        s.stop(end);
      } catch {
        /* Already stopped */
      }
    });
    const disconnect = () => {
      master.disconnect();
      headroom.disconnect();
      glue.disconnect();
      output.disconnect();
    };
    if (fade > 0) setTimeout(disconnect, fade * 1000 + 50);
    else disconnect();
  };
}
export async function renderMix(tracks: Track[], mix: Mix) {
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil((duration(tracks) + 2) * 44100),
    44100,
  );
  graph(ctx, tracks, mix, ctx.destination);
  const rendered = await ctx.startRendering();
  // A linked stereo ceiling preserves the stereo image and prevents PCM clipping.
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    const samples = rendered.getChannelData(channel);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0.98) {
    const gain = 0.98 / peak;
    for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
      const samples = rendered.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
  }
  return rendered;
}
export function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels,
    length = buffer.length;
  const bytes = new ArrayBuffer(44 + length * channels * 2);
  const v = new DataView(bytes);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, bytes.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) =>
    buffer.getChannelData(c),
  );
  for (let i = 0; i < length; i++)
    for (let c = 0; c < channels; c++) {
      const n = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(
        44 + (i * channels + c) * 2,
        n < 0 ? n * 32768 : n * 32767,
        true,
      );
    }
  return new Blob([bytes], { type: "audio/wav" });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("vocalroom", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveProject(
  id: string,
  name: string,
  tracks: Track[],
  mix: Mix,
  processed?: {
    buffer: AudioBuffer;
    signature: string;
    report?: import("./studio-dsp").ProductionReport;
  } | null,
) {
  // Store exact PCM: decoding a WAV on reopen can resample it to the device rate.
  const serialize = (buffer: AudioBuffer) => ({
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c).slice(),
    ),
  });
  const stored = tracks.map(({ buffer, ...settings }) => ({
    ...settings,
    pcm: serialize(buffer),
  }));
  const database = await db();
  const processedAudio = processed
    ? {
        signature: processed.signature,
        report: processed.report,
        pcm: serialize(processed.buffer),
      }
    : null;
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("projects", "readwrite");
    tx.objectStore("projects").put({
      id,
      name,
      tracks: stored,
      mix,
      processed: processedAudio,
      updated: Date.now(),
    });
    tx.oncomplete = () => {
      database.close();
      resolve();
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(
        tx.error ??
          new Error("Storage is full. Export your mix to keep a copy."),
      );
    };
  });
}
export async function projects() {
  const database = await db();
  return new Promise<any[]>((resolve, reject) => {
    const r = database.transaction("projects").objectStore("projects").getAll();
    r.onsuccess = () => {
      database.close();
      resolve(r.result.sort((a, b) => b.updated - a.updated));
    };
    r.onerror = () => reject(r.error);
  });
}
export async function loadProject(project: any) {
  const restore = async (audio: any): Promise<AudioBuffer> => {
    if (audio.pcm) {
      const { channels, sampleRate } = audio.pcm;
      const buffer = audioContext().createBuffer(
        channels.length,
        channels[0].length,
        sampleRate,
      );
      channels.forEach((data: Float32Array, c: number) =>
        buffer.copyToChannel(data, c),
      );
      return buffer;
    }
    // Read projects written by the original WAV-based storage format too.
    return audioContext().decodeAudioData(audio.buffer.slice(0));
  };
  const tracks = await Promise.all(
    project.tracks.map(async (t: any) => {
      const { pcm, buffer, ...settings } = t;
      return { ...settings, buffer: await restore(t) };
    }),
  );
  const processed = project.processed
    ? {
        signature: project.processed.signature,
        report: project.processed.report,
        buffer: await restore(project.processed),
      }
    : null;
  return {
    ...project,
    mix: { ...project.mix, engine: project.mix.engine ?? "legacy" },
    tracks,
    processed,
  };
}

/** Start a pre-rendered stereo mix at the same timeline position as the originals. */
export function playRendered(
  ctx: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  when: number,
  offset: number,
  comparisonGain = 1,
) {
  const source = ctx.createBufferSource(),
    output = ctx.createGain();
  source.buffer = buffer;
  source.connect(output);
  output.connect(destination);
  output.gain.setValueAtTime(0, when);
  output.gain.linearRampToValueAtTime(comparisonGain, when + 0.008);
  if (offset < buffer.duration) source.start(when, Math.max(0, offset));
  return (fade = 0) => {
    output.gain.cancelScheduledValues(ctx.currentTime);
    output.gain.setValueAtTime(output.gain.value, ctx.currentTime);
    output.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    try {
      source.stop(ctx.currentTime + fade);
    } catch {}
    setTimeout(() => output.disconnect(), fade * 1000 + 50);
  };
}
