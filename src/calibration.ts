import { createPcmCapture } from "./capture";

/** Deterministic short chirp; normalized correlation rejects unrelated room noise. */
export function timingPulse(rate: number) {
  return Float32Array.from({ length: Math.round(rate * 0.035) }, (_, i) => {
    const t = i / rate;
    return (
      Math.sin(2 * Math.PI * (700 * t + 18000 * t * t)) *
      Math.sin((Math.PI * i) / (rate * 0.035)) ** 2
    );
  });
}
export function detectRoundTrip(
  samples: Float32Array,
  rate: number,
  times: number[],
) {
  const stride = Math.max(1, Math.round(rate / 8000));
  const pulse = timingPulse(rate);
  const lags: number[] = [];
  for (const time of times) {
    let best = 0,
      lag = 0;
    for (let delay = 0; delay < rate * 0.8; delay += stride) {
      const start = Math.round(time * rate) + delay;
      let dot = 0,
        a = 0,
        b = 0;
      for (let i = 0; i < pulse.length; i += stride) {
        const x = samples[start + i] || 0,
          y = pulse[i];
        dot += x * y;
        a += x * x;
        b += y * y;
      }
      const score = Math.abs(dot) / Math.sqrt(a * b + 1e-20);
      if (score > best) {
        best = score;
        lag = delay;
      }
    }
    if (best < 0.55)
      throw new Error(
        "Could not hear the timing tones clearly. Hold a wired headphone earcup close to the microphone in a quiet room and retry.",
      );
    lags.push((lag / rate) * 1000);
  }
  if (Math.max(...lags) - Math.min(...lags) > 12)
    throw new Error(
      "Timing varied between tones. Use wired headphones, close other audio apps, and retry.",
    );
  return Math.round(lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)]);
}

/** Acoustic loopback only; microphone is never monitored to the output. */
export async function calibrateRecording(ctx: AudioContext, deviceId: string) {
  await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  let capture: Awaited<ReturnType<typeof createPcmCapture>> | undefined;
  const sources: AudioBufferSourceNode[] = [];
  try {
    capture = await createPcmCapture(ctx, stream);
    const origin = ctx.currentTime + 0.15,
      times = [0.35, 1.5, 2.65];
    const pulse = ctx.createBuffer(
      1,
      Math.round(ctx.sampleRate * 0.035),
      ctx.sampleRate,
    );
    pulse.copyToChannel(timingPulse(ctx.sampleRate), 0);
    capture.start(origin);
    for (const time of times) {
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = pulse;
      gain.gain.value = 0.12;
      source.connect(gain).connect(ctx.destination);
      source.start(origin + time);
      sources.push(source);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
    }
    // Schedule stop on the same sample clock, rather than relying on a JS timer.
    const buffer = await capture.stop(origin + 3.6);
    return detectRoundTrip(buffer.getChannelData(0), buffer.sampleRate, times);
  } finally {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    }
    capture?.dispose();
    stream.getTracks().forEach((track) => track.stop());
  }
}
