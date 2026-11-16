import {
  audioContext,
  makeTrack,
  renderMix,
  encodeWav,
  saveProject,
  projects,
  loadProject,
  type Mix,
} from "../src/audio";
import { processSession, mixSignature } from "../src/processing";
import { loudnessEstimate } from "../src/studio-dsp";
const results = document.querySelector("#results")!;
let checks = 0;
const assert = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
  checks++;
  results.textContent += `PASS: ${message}\n`;
};
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  results.textContent = "";
  checks = 0;
  const begin = performance.now();
  try {
    const ctx = audioContext();
    await ctx.resume();
    const rate = ctx.sampleRate;
    const voice = ctx.createBuffer(1, rate * 2, rate),
      back = ctx.createBuffer(2, rate * 2, rate);
    for (let i = 0; i < voice.length; i++) {
      const time = i / rate;
      voice.getChannelData(0)[i] =
        time > 0.1
          ? 0.15 * Math.sin(2 * Math.PI * 220 * time) +
            0.1 * Math.sin(2 * Math.PI * 2800 * time)
          : 0;
      const value =
        0.15 * Math.sin(2 * Math.PI * 2800 * time) +
        0.12 * Math.sin(2 * Math.PI * 120 * time);
      back.getChannelData(0)[i] = value;
      back.getChannelData(1)[i] = value * 0.8;
    }
    const vocal = makeTrack("Generated vocal harmonics", voice, "vocal"),
      instrument = makeTrack("Generated instrumental", back, "backing"),
      tracks = [
        { ...vocal, offset: 0.2, trimStart: 0.1, trimEnd: 1.9 },
        instrument,
      ];
    const originals = voice.getChannelData(0).slice(),
      mix: Mix = {
        enabled: true,
        preset: "Natural",
        intensity: 0.65,
        noiseReduction: 0,
        autoMix: true,
        engine: "studio",
      };
    const stages = new Set<string>();
    const processed = await processSession(tracks, mix, (p) =>
      stages.add(p.stage),
    );
    assert(
      processed.report?.engine === "studio-v1" &&
        stages.has("vocal") &&
        stages.has("master"),
      "Actual worker analysis, vocal processing, mastering and progress stages execute",
    );
    assert(
      voice.getChannelData(0).every((x, i) => x === originals[i]),
      "The original vocal PCM remains exactly unchanged",
    );
    const report = processed.report!;
    assert(
      report.maskingCutDb > 0 && report.maskingCutDb <= 2,
      "Overlapping presence triggers a bounded backing EQ cut",
    );
    assert(
      report.master.samplePeak <= 0.971 &&
        report.master.reconstructionPeak4x <= 0.971,
      "Stereo master and 4x reconstructed peak estimate stay below the output ceiling",
    );
    assert(
      processed.buffer.getChannelData(0).every(Number.isFinite) &&
        processed.buffer.numberOfChannels === 2,
      "The rendered result is finite stereo audio",
    );
    const raw = await renderMix(tracks, { ...mix, enabled: false });
    const dryLufs = loudnessEstimate(
      [raw.getChannelData(0), raw.getChannelData(1)],
      raw.sampleRate,
    )!;
    const dryMatched = dryLufs + 20 * Math.log10(report.originalComparisonGain),
      wetMatched =
        report.master.outputLufsEstimate! +
        20 * Math.log10(report.processedComparisonGain);
    assert(
      Math.abs(dryMatched - wetMatched) < 0.05 &&
        report.originalComparisonGain <= 1 &&
        report.processedComparisonGain <= 1,
      "Original and processed listening levels match using attenuation, without changing exports",
    );
    const wav = new DataView(await encodeWav(processed.buffer).arrayBuffer());
    let quantized = true;
    for (let i = 0; i < Math.min(10000, processed.buffer.length); i++) {
      if (
        Math.abs(
          wav.getInt16(44 + i * 4, true) / 32768 -
            processed.buffer.getChannelData(0)[i],
        ) >
        2 / 32768
      )
        quantized = false;
    }
    assert(
      quantized,
      "WAV export contains the actual cached processed PCM within 16-bit quantization",
    );
    await saveProject(
      "studio-polish-integration",
      "Studio Polish test — generated audio",
      tracks,
      mix,
      processed,
    );
    const saved = (await projects()).find(
      (p) => p.id === "studio-polish-integration",
    );
    const loaded = await loadProject(saved);
    assert(
      loaded.processed?.signature === mixSignature(loaded.tracks, loaded.mix) &&
        loaded.processed?.report.engine === "studio-v1" &&
        loaded.tracks[0].buffer
          .getChannelData(0)
          .every((x: number, i: number) => x === originals[i]),
      "Projects restore exact source PCM, Studio Polish settings, analysis and the cached mix",
    );
    const legacyMix = { ...mix, engine: undefined };
    const legacy = await processSession(tracks, legacyMix, () => {});
    await saveProject(
      "studio-classic-compatibility",
      "Classic compatibility — generated audio",
      tracks,
      legacyMix,
      legacy,
    );
    const old = await loadProject(
      (await projects()).find((p) => p.id === "studio-classic-compatibility"),
    );
    assert(
      old.mix.engine === "legacy" &&
        old.processed.signature === mixSignature(old.tracks, old.mix),
      "Projects without an engine setting retain the original Classic DSP cache",
    );
    const controller = new AbortController();
    let cancelled = false;
    try {
      await processSession(
        tracks,
        mix,
        (p) => {
          if (p.stage === "vocal" && p.progress > 0.46) controller.abort();
        },
        controller.signal,
      );
    } catch (e) {
      cancelled = e instanceof DOMException && e.name === "AbortError";
    }
    assert(
      cancelled && voice.getChannelData(0).every((x, i) => x === originals[i]),
      "Cancellation during vocal work discards the result and preserves originals",
    );
    const withDelay = await processSession(
      tracks,
      { ...mix, stereoDelay: true },
      () => {},
    );
    let delta = 0;
    for (let i = 0; i < withDelay.buffer.length; i += 10)
      delta += Math.abs(
        withDelay.buffer.getChannelData(0)[i] -
          processed.buffer.getChannelData(0)[i],
      );
    assert(
      delta > 0.01 && withDelay.signature !== processed.signature,
      "Optional stereo delay changes real audio and invalidates the processed cache",
    );
    results.textContent += `\nALL ${checks} STUDIO CHECKS PASSED in ${((performance.now() - begin) / 1000).toFixed(2)} seconds. Synthetic signals only.\n`;
  } catch (e) {
    results.textContent += `FAIL: ${e instanceof Error ? e.stack : e}`;
  }
};
