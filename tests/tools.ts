import { audioContext, makeTrack } from "../src/audio";
import { renderDryStem, encodeMp3 } from "../src/exports";
import { splitAt } from "../src/editing";
import { timingPulse, detectRoundTrip } from "../src/calibration";
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const lines: string[] = [],
    log = (s: string) => {
      lines.push(s);
      document.querySelector("#results")!.textContent = lines.join("\n");
    };
  const check = (value: boolean, label: string) => {
    if (!value) throw new Error(label);
    log("PASS " + label);
  };
  try {
    const ctx = audioContext();
    await ctx.resume();
    const vocal = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const backing = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    for (let i = 0; i < vocal.length; i++) {
      vocal.getChannelData(0)[i] =
        Math.sin((i / ctx.sampleRate) * 2 * Math.PI * 440) * 0.1;
      backing.getChannelData(0)[i] =
        Math.sin((i / ctx.sampleRate) * 2 * Math.PI * 1700) * 0.8;
    }
    const take = makeTrack("Vocal", vocal, "vocal"),
      music = makeTrack("Music", backing, "backing");
    take.volume = 1;
    music.volume = 1;
    const dry = await renderDryStem([take, music], "vocal");
    const parts = splitAt(take, 0.8)!;
    const split = await renderDryStem([...parts, music], "vocal");
    let error = 0,
      peak = 0;
    for (let i = 0; i < dry.length; i++) {
      error = Math.max(
        error,
        Math.abs(dry.getChannelData(0)[i] - split.getChannelData(0)[i]),
      );
      peak = Math.max(peak, Math.abs(dry.getChannelData(0)[i]));
    }
    check(
      error < 0.00001,
      "Split and unsplit render identically on the timeline",
    );
    check(
      peak < 0.11 && peak > 0.05,
      "Dry vocal stem excludes the much louder backing",
    );
    check(vocal.getChannelData(0)[100] !== 0, "Original source PCM retained");
    const mp3 = await encodeMp3(dry);
    const decoded = await ctx.decodeAudioData(await mp3.arrayBuffer());
    check(
      mp3.size > 1000 && Math.abs(decoded.duration - dry.duration) < 0.1,
      "Real worker MP3 encodes and browser decodes with expected codec padding",
    );
    for (const rate of [44100, 48000]) {
      const signal = new Float32Array(rate * 4),
        pulse = timingPulse(rate),
        times = [0.35, 1.5, 2.65],
        delay = 0.137;
      times.forEach((t) => signal.set(pulse, Math.round((t + delay) * rate)));
      check(
        Math.abs(detectRoundTrip(signal, rate, times) - 137) < 1,
        "Loopback detector recovers 137 ms at " + rate + " Hz",
      );
      let failed = false;
      try {
        detectRoundTrip(new Float32Array(rate * 4), rate, times);
      } catch {
        failed = true;
      }
      check(failed, "Loopback rejects silence at " + rate + " Hz");
    }
    log(
      "ALL 8 CHECKS PASSED — synthetic audio only; no hardware calibration claimed.",
    );
  } catch (e) {
    log("FAIL " + String(e));
  }
};
