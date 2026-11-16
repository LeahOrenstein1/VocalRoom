import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../src/noise.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { reduceNoise } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const rms = (a) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
function noise(length) {
  let seed = 42;
  return Float32Array.from({ length }, () => {
    seed = (seed * 16807) % 2147483647;
    return ((seed / 2147483647) * 2 - 1) * 0.02;
  });
}
test("Noise reduction measurably lowers steady noise without mutating the recording", () => {
  const input = noise(44100),
    original = input.slice();
  const result = reduceNoise(input, 44100, 0.85);
  assert.deepEqual(input, original);
  assert.equal(result.length, input.length);
  assert.ok(
    rms(result) < rms(input) * 0.82,
    `Noise RMS ${rms(result)} should be below ${rms(input) * 0.82}`,
  );
  assert.ok([...result].every(Number.isFinite));
});
test("A sustained singing-like harmonic is retained while noise is reduced", () => {
  const input = noise(44100);
  for (let i = 0; i < input.length; i++)
    input[i] += 0.22 * Math.sin((2 * Math.PI * 440 * i) / 44100);
  const result = reduceNoise(input, 44100, 0.7);
  let projection = 0;
  for (let i = 0; i < result.length; i++)
    projection += result[i] * Math.sin((2 * Math.PI * 440 * i) / 44100);
  assert.ok((2 * projection) / result.length > 0.18);
});
test("Zero intensity is an exact independent copy and silence stays finite", () => {
  const input = noise(4000);
  const bypass = reduceNoise(input, 48000, 0);
  assert.deepEqual(bypass, input);
  assert.notEqual(bypass, input);
  assert.ok(
    reduceNoise(new Float32Array(4000), 48000, 1).every((x) => x === 0),
  );
});

test("A genuine noise-only profile improves hum removal while retaining the sung harmonic", () => {
  const rate = 44100,
    input = noise(rate);
  for (let i = 0; i < input.length; i++) {
    input[i] += 0.04 * Math.sin((2 * Math.PI * 60 * i) / rate);
    if (i > rate * 0.3)
      input[i] += 0.22 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  const automatic = reduceNoise(input, rate, 0.85),
    profiled = reduceNoise(input, rate, 0.85, () => {}, 0.25);
  const project = (samples, freq) => {
    let sum = 0;
    const start = Math.floor(rate * 0.4);
    for (let i = start; i < samples.length; i++)
      sum += samples[i] * Math.sin((2 * Math.PI * freq * i) / rate);
    return Math.abs((2 * sum) / (samples.length - start));
  };
  assert.ok(project(profiled, 60) < project(automatic, 60) * 0.75);
  assert.ok(project(profiled, 440) > 0.16);
});
