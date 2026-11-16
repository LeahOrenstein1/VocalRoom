/** Filename-based naming; no network or simulated AI. */
export function suggestedProjectName(filename: string) {
  const title = filename
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(
      /[\[(][^\])]*(?:karaoke|instrumental|backing\s*track|no\s*vocals?|official\s*audio|\d{2,3}\s*kbps)[^\])]*[\])]/gi,
      " ",
    )
    .replace(
      /\b(?:karaoke(?:\s+version)?|instrumental(?:\s+version)?|backing\s*track|no\s*vocals?|official\s*audio|\d{2,3}\s*kbps)\b/gi,
      " ",
    )
    .replace(/\s*[-–—]+\s*/g, " — ")
    .replace(/\s+/g, " ")
    .replace(/^[\s—-]+|[\s—-]+$/g, "")
    .trim();
  return (title || "New session").slice(0, 90);
}
import type { Track } from "./audio";
export function canSplitAt(track: Track, position: number) {
  const point = track.trimStart + position - track.offset;
  return (
    Number.isFinite(position) &&
    point > track.trimStart + 0.005 &&
    point < track.trimEnd - 0.005
  );
}
export function splitAt(track: Track, position: number): [Track, Track] | null {
  const point = track.trimStart + position - track.offset;
  if (!canSplitAt(track, position)) return null;
  return [
    { ...track, trimEnd: point },
    {
      ...track,
      id: crypto.randomUUID(),
      name: `${track.name} (part 2)`,
      trimStart: point,
      offset: position,
    },
  ];
}
export function trimStartAt(track: Track, trimStart: number): Track {
  const value = Math.min(track.trimEnd - 0.01, Math.max(0, trimStart));
  return {
    ...track,
    trimStart: value,
    offset: track.offset + value - track.trimStart,
  };
}
