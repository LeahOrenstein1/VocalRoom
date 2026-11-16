import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../src/audio.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { encodeWav, analyze, duration } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
test("WAV encodes channels in interleaved order with correct clipping", async () => {
  const channels = [
    new Float32Array([-2, 0, 0.5]),
    new Float32Array([2, -0.5, 0]),
  ];
  const blob = encodeWav({
    numberOfChannels: 2,
    length: 3,
    sampleRate: 48000,
    getChannelData: (c) => channels[c],
  });
  const v = new DataView(await blob.arrayBuffer());
  assert.equal(v.byteLength, 56);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(v.getInt16(44, true), -32768);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(50, true), -16384);
});
test("Vocal analysis measures known RMS and peak", () => {
  const a = analyze({
    getChannelData: () => new Float32Array([0.5, -0.5, 0.5, -0.5]),
  });
  assert.equal(a.rms, 0.5);
  assert.equal(a.peak, 0.5);
});
test("Timeline duration respects both trim and negative sync", () => {
  assert.equal(duration([{ offset: -2, trimStart: 1, trimEnd: 8 }]), 5);
  assert.equal(duration([{ offset: 2, trimStart: 1, trimEnd: 8 }]), 9);
});
