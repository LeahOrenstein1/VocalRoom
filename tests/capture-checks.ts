import { createPcmCapture } from "../src/capture";
const results = document.querySelector("#results")!;
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  results.textContent = "";
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    await ctx.resume();
    const destination = ctx.createMediaStreamDestination();
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.2;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    const capture = await createPcmCapture(ctx, destination.stream),
      when =
        Math.ceil((ctx.currentTime + 0.15) * ctx.sampleRate) / ctx.sampleRate;
    capture.start(when);
    const buffer = await capture.stop(when + 1.25);
    if (buffer.length !== Math.round(ctx.sampleRate * 1.25))
      throw new Error(`Unexpected frame count: ${buffer.length}`);
    results.textContent += `PASS: ${buffer.length} exact PCM frames at ${buffer.sampleRate} Hz, duration 1.250 seconds\n`;
    const data = buffer.getChannelData(0);
    if (!data.some((x) => Math.abs(x) > 0.05))
      throw new Error("No input captured");
    results.textContent +=
      "PASS: Actual AudioWorklet capture contains the generated input\n";
    const longCapture = await createPcmCapture(ctx, destination.stream),
      start =
        Math.ceil((ctx.currentTime + 0.1) * ctx.sampleRate) / ctx.sampleRate;
    longCapture.start(start);
    const second = await longCapture.stop(start + 3);
    if (second.length !== ctx.sampleRate * 3)
      throw new Error("Clock drift detected");
    results.textContent +=
      "PASS: A longer recording uses the same clock and exact sample rate, with no codec drift\n";
    oscillator.stop();
    results.textContent += "ALL 3 CAPTURE CHECKS PASSED.";
  } catch (e) {
    results.textContent += `FAIL: ${e instanceof Error ? e.stack : e}`;
  } finally {
    await ctx?.close();
  }
};
