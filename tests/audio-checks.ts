import {
  audioContext,
  makeTrack,
  renderMix,
  encodeWav,
  saveProject,
  projects,
  loadProject,
} from "../src/audio";
import { processSession, mixSignature } from "../src/processing";
const results = document.querySelector("#results")!;
const assert = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
  results.textContent += `PASS: ${message}\n`;
};
const rms = (b: AudioBuffer) => {
  const d = b.getChannelData(0);
  return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
};
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  results.textContent = "";
  try {
    const ctx = audioContext();
    await ctx.resume();
    const buffer = ctx.createBuffer(1, 22050, 44100);
    const a = buffer.getChannelData(0);
    for (let i = 0; i < a.length; i++)
      a[i] = 0.25 * Math.sin((i / 44100) * 2 * Math.PI * 440);
    const t = makeTrack("Generated test tone", buffer, "vocal");
    const off = { enabled: false, preset: "Natural" as const, intensity: 0.7 };
    const dry = await renderMix([t], off);
    assert(rms(dry) > 0.02, "Real mixed PCM contains the generated input");
    const silent = await renderMix([{ ...t, mute: true }], off);
    assert(rms(silent) === 0, "Muted track exports silence");
    const solo = await renderMix(
      [
        { ...t, solo: true },
        { ...t, id: "muted-by-solo", volume: 1.4 },
      ],
      off,
    );
    assert(
      Math.abs(rms(solo) - rms(dry)) < 0.00001,
      "Solo excludes the other track",
    );
    const delayed = await renderMix(
      [{ ...t, offset: 0.25, trimStart: 0.1, trimEnd: 0.3 }],
      off,
    );
    assert(
      delayed
        .getChannelData(0)
        .slice(0, 11000)
        .every((x) => x === 0),
      "Positive sync delays the trimmed audio",
    );
    assert(
      delayed
        .getChannelData(0)
        .slice(12000, 18000)
        .some((x) => Math.abs(x) > 0.01),
      "Trimmed audio starts at the scheduled time",
    );
    const advanced = await renderMix([{ ...t, offset: -0.1 }], off);
    assert(
      advanced
        .getChannelData(0)
        .slice(20000)
        .every((x) => Math.abs(x) < 0.00001),
      "Negative sync advances once without double trimming",
    );
    const wet = await renderMix([t], { ...off, enabled: true });
    assert(
      Math.abs(rms(wet) - rms(dry)) > 0.0001,
      "Real DSP changes the rendered audio",
    );
    const original = t.buffer.getChannelData(0).slice();
    const stages = new Set<string>();
    const processed = await processSession(
      [t],
      { ...off, noiseReduction: 0.65, autoMix: true },
      (p) => stages.add(p.stage),
    );
    assert(
      stages.has("noise") && stages.has("render") && stages.has("balance"),
      "Processing progress reports actual worker, balancing, and render stages",
    );
    assert(
      t.buffer.getChannelData(0).every((sample, i) => sample === original[i]),
      "Processing preserves every original PCM sample",
    );
    assert(
      processed.signature !== mixSignature([{ ...t, offset: 1 }], off),
      "Moving a track invalidates an outdated processed mix",
    );
    assert(
      processed.buffer.length > 0 && rms(processed.buffer) > 0,
      "Full-session processing renders genuine playable audio",
    );
    const backing = makeTrack("Generated backing", buffer, "backing");
    const together = await processSession([t, backing], off, () => {});
    assert(
      Math.abs(rms(together.buffer) - rms(processed.buffer)) > 0.0001,
      "The finished mix includes the actual backing track as well as processed vocals",
    );
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try {
      await processSession([t], off, () => {}, controller.signal);
    } catch (e) {
      cancelled = e instanceof DOMException && e.name === "AbortError";
    }
    assert(
      cancelled,
      "Cancelled processing never replaces the original session",
    );
    const blob = encodeWav(wet);
    const bytes = await blob.arrayBuffer();
    const v = new DataView(bytes);
    assert(
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
        v.getUint16(22, true) === 2 &&
        v.getUint32(24, true) === 44100,
      "Export is a valid stereo 44.1 kHz PCM WAV",
    );
    const id = "vocalroom-integration-test";
    await saveProject(id, "Audio integration test", [t], off, processed);
    const stored = (await projects()).find((p) => p.id === id);
    const restored = await loadProject(stored);
    assert(
      restored.tracks.length === 1 &&
        Math.abs(restored.tracks[0].buffer.duration - 0.5) < 0.001,
      "IndexedDB round-trip restores audio and settings",
    );
    assert(
      restored.processed?.buffer.length === processed.buffer.length &&
        restored.processed?.signature === processed.signature,
      "Saved projects restore the processed mix separately from originals",
    );
    assert(
      restored.tracks[0].buffer.sampleRate === t.buffer.sampleRate &&
        restored.tracks[0].buffer
          .getChannelData(0)
          .every((x: number, i: number) => x === original[i]),
      "Project save and reopen preserve exact original PCM and sample rate",
    );
    results.textContent +=
      "\nALL 17 CHECKS PASSED. Test project retained under My projects.\n";
  } catch (e) {
    results.textContent += `FAIL: ${e instanceof Error ? e.stack : e}`;
  }
};
