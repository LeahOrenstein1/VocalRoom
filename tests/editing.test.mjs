import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(
  fs.readFileSync(new URL("../src/editing.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { suggestedProjectName, splitAt, trimStartAt } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const track = {
  id: "1",
  name: "Take",
  trimStart: 2,
  trimEnd: 8,
  offset: -0.2,
  buffer: {},
};
test("Splitting preserves every source position, duration, PCM reference and negative timeline offsets", () => {
  const [a, b] = splitAt(track, 3);
  assert.equal(a.buffer, track.buffer);
  assert.equal(b.buffer, track.buffer);
  assert.equal(a.trimEnd, b.trimStart);
  assert.equal(a.offset + a.trimEnd - a.trimStart, b.offset);
  assert.equal(
    b.offset + b.trimEnd - b.trimStart,
    track.offset + track.trimEnd - track.trimStart,
  );
  assert.notEqual(a.id, b.id);
  for (let t = 0; t < 5.8; t += 0.01) {
    const part = t < 3 ? a : b;
    assert.ok(
      Math.abs(
        part.trimStart + t - part.offset - (track.trimStart + t - track.offset),
      ) < 1e-9,
    );
  }
  assert.equal(splitAt(track, 10), null);
  assert.equal(splitAt(track, -0.2), null);
  assert.equal(track.trimEnd, 8);
});
test("Trimming the beginning keeps retained audio at its original timeline time", () => {
  const cut = trimStartAt(track, 4);
  assert.ok(Math.abs(cut.offset - 1.8) < 1e-12);
  assert.ok(
    Math.abs(
      cut.trimStart + 3 - cut.offset - (track.trimStart + 3 - track.offset),
    ) < 1e-12,
  );
});
test("Filename cleanup retains artist and song; it does not invent an AI title", () => {
  assert.equal(
    suggestedProjectName(
      "Billie Eilish - lovely (with Khalid) (Karaoke Version).mp3",
    ),
    "Billie Eilish — lovely (with Khalid)",
  );
  assert.equal(suggestedProjectName("My_song_[instrumental].wav"), "My song");
  assert.equal(suggestedProjectName("karaoke.mp3"), "New session");
});
