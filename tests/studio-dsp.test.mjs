import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(
  fs.readFileSync(new URL("../src/studio-dsp.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  analyzeSignal,
  vocalPlan,
  processVocal,
  masterSignal,
  loudnessEstimate,
  reconstructionPeak4x,
} = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const rate = 24000;
const tone = (hz, seconds = 1, amplitude = 0.2) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
  );
const rms = (a) =>
  Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / Math.max(1, a.length));
const project = (a, hz, start = 0, end = a.length) => {
  let sum = 0;
  for (let i = start; i < end; i++)
    sum += a[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  return Math.abs((2 * sum) / (end - start));
};
test("Analysis distinguishes rumble, presence and sibilance with finite silence behavior", () => {
  const low = analyzeSignal([tone(45)], rate),
    voice = analyzeSignal([tone(2800)], rate),
    sibilant = analyzeSignal([tone(7200)], rate);
  assert.ok(low.bands.rumble > voice.bands.rumble * 10);
  assert.ok(voice.bands.presence > low.bands.presence * 10);
  assert.ok(sibilant.bands.sibilance > voice.bands.sibilance);
  const silent = analyzeSignal([new Float32Array(rate)], rate);
  assert.equal(silent.rms, 0);
  assert.equal(silent.lufsEstimate, null);
  assert.equal(silent.dynamicRangeDb, 0);
});
test("Gated loudness is insensitive to trailing digital silence and tracks a 6 dB gain", () => {
  const a = tone(1000, 2, 0.2),
    b = new Float32Array(rate * 5);
  b.set(a);
  assert.ok(
    Math.abs(loudnessEstimate([a], rate) - loudnessEstimate([b], rate)) < 0.5,
  );
  assert.ok(
    Math.abs(
      loudnessEstimate([tone(1000, 2, 0.4)], rate) -
        loudnessEstimate([a], rate) -
        6.0206,
    ) < 0.02,
  );
});
test("Vocal processing does not mutate sources and zero intensity is an exact independent bypass", () => {
  const a = tone(220),
    copy = a.slice(),
    analysis = analyzeSignal([a], rate);
  const processed = processVocal(
    [a],
    rate,
    vocalPlan(analysis, "Natural", 0.7),
    0.7,
  )[0];
  assert.deepEqual(a, copy);
  assert.equal(processed.length, a.length);
  assert.ok(processed.every(Number.isFinite));
  const bypass = processVocal(
    [a],
    rate,
    vocalPlan(analysis, "Natural", 0),
    0,
  )[0];
  assert.deepEqual(bypass, a);
  assert.notEqual(bypass, a);
});
test("Adaptive high-pass reduces rumble relative to a retained vocal fundamental", () => {
  const a = tone(220);
  for (let i = 0; i < a.length; i++)
    a[i] += 0.2 * Math.sin((2 * Math.PI * 35 * i) / rate);
  const plan = vocalPlan(analyzeSignal([a], rate), "Natural", 0.7);
  const out = processVocal([a], rate, plan, 0.7)[0];
  assert.ok(
    project(out, 35) / project(out, 220) <
      (project(a, 35) / project(a, 220)) * 0.65,
  );
});
test("De-essing selectively reduces a sibilant burst while preserving the earlier vowel", () => {
  const a = tone(440, 2, 0.15);
  for (let i = rate; i < a.length; i++)
    a[i] += 0.25 * Math.sin((2 * Math.PI * 7200 * i) / rate);
  const plan = vocalPlan(analyzeSignal([a], rate), "Natural", 0.8),
    dry = processVocal([a], rate, { ...plan, maxDeessDb: 0 }, 0.8)[0],
    wet = processVocal([a], rate, { ...plan, maxDeessDb: 6 }, 0.8)[0];
  assert.ok(
    project(wet, 7200, rate + rate / 4) <
      project(dry, 7200, rate + rate / 4) * 0.8,
  );
  assert.ok(
    Math.abs(
      rms(wet.subarray(rate / 4, (rate * 3) / 4)) -
        rms(dry.subarray(rate / 4, (rate * 3) / 4)),
    ) < 0.001,
  );
});
test("Compression and slow gain riding reduce phrase level differences without flattening them", () => {
  const a = tone(440, 4, 0.05);
  for (let i = rate * 2; i < a.length; i++) a[i] *= 8;
  const out = processVocal(
    [a],
    rate,
    vocalPlan(analyzeSignal([a], rate), "Natural", 0.7),
    0.7,
  )[0];
  const ratio =
    rms(out.subarray(rate * 3, rate * 4)) / rms(out.subarray(rate, rate * 2));
  assert.ok(ratio > 1.2 && ratio < 7, `phrase ratio ${ratio}`);
});
test("Linked master peak protection retains stereo ratios, frame positions, and original PCM", () => {
  const left = tone(1000, 1, 2),
    right = Float32Array.from(left, (x) => x * 0.4),
    copy = left.slice();
  left[10000] = 4;
  right[10000] = 1.6;
  const before = left.slice();
  const { channels, report } = masterSignal([left, right], rate);
  assert.deepEqual(left, before);
  assert.equal(channels[0].length, left.length);
  assert.ok(channels.every((c) => c.every(Number.isFinite)));
  assert.ok(report.samplePeak <= 0.971);
  assert.ok(report.reconstructionPeak4x <= 0.971);
  for (let i = 0; i < left.length; i++)
    assert.ok(Math.abs(channels[1][i] - channels[0][i] * 0.4) < 1e-6);
  assert.ok(channels[0][10000] > 0);
});
test("4x reconstruction actually detects an intersample peak", () => {
  const a = Float32Array.from({ length: 1000 }, (_, i) =>
    Math.sin((Math.PI / 2) * i + Math.PI / 4),
  );
  const samplePeak = Math.max(...a.map(Math.abs));
  assert.ok(reconstructionPeak4x([a]) > samplePeak * 1.2);
});
test("Silent mastering stays silent and reports no loudness or artificial gain", () => {
  const a = new Float32Array(rate);
  const { channels, report } = masterSignal([a, a], rate);
  assert.ok(channels.every((c) => c.every((x) => x === 0)));
  assert.equal(report.outputLufsEstimate, null);
  assert.equal(report.normalizationDb, 0);
  assert.equal(report.samplePeak, 0);
});
