import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(
  new URL("../src/capture.worklet.js", import.meta.url),
  "utf8",
);
function fixture() {
  let Capture;
  const messages = [];
  const context = {
    Float32Array,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (data) => messages.push(data) };
      }
    },
    registerProcessor: (_, Class) => (Capture = Class),
  };
  vm.runInNewContext(code, context);
  return { context, processor: new Capture(), messages };
}
for (const rate of [44100, 48000])
  test(`PCM capture keeps exact frame counts at ${rate} Hz over varied audio blocks`, () => {
    const { context, processor, messages } = fixture(),
      start = 173,
      end = start + rate * 10;
    processor.port.onmessage({ data: { type: "start", frame: start } });
    processor.port.onmessage({ data: { type: "stop", frame: end } });
    for (let frame = 0; frame <= end + 512;) {
      const size = frame % 3 === 0 ? 256 : 128;
      context.currentFrame = frame;
      const input = Float32Array.from(
        { length: size },
        (_, i) => ((frame + i) % 257) / 257,
      );
      processor.process([[input]], [[new Float32Array(size)]]);
      frame += size;
    }
    const done = messages.find((m) => m.type === "stopped");
    assert.equal(done.frames, rate * 10);
    const chunks = messages
      .filter((m) => m.type === "samples")
      .flatMap((m) => Array.from(m.samples));
    assert.equal(chunks.length, rate * 10);
    for (let i = 0; i < chunks.length; i++)
      assert.ok(Math.abs(chunks[i] - ((start + i) % 257) / 257) < 1e-6);
  });
test("A silent or temporarily empty input preserves the capture timeline rather than speeding it up", () => {
  const { context, processor, messages } = fixture();
  processor.port.onmessage({ data: { type: "start", frame: 20 } });
  processor.port.onmessage({ data: { type: "stop", frame: 300 } });
  for (let frame = 0; frame < 512; frame += 128) {
    context.currentFrame = frame;
    processor.process([[]], [[new Float32Array(128)]]);
  }
  assert.equal(messages.find((m) => m.type === "stopped").frames, 280);
  assert.ok(
    messages
      .filter((m) => m.type === "samples")
      .every((m) => m.samples.every((x) => x === 0)),
  );
});
