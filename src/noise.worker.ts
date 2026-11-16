import { reduceNoise } from "./noise";
self.onmessage = (
  event: MessageEvent<{
    channels: Float32Array[];
    sampleRate: number;
    strength: number;
    noiseProfileSeconds?: number;
  }>,
) => {
  try {
    const { channels, sampleRate, strength, noiseProfileSeconds } = event.data;
    const result = channels.map((samples, channel) =>
      reduceNoise(
        samples,
        sampleRate,
        strength,
        (p) => self.postMessage({ progress: (channel + p) / channels.length }),
        noiseProfileSeconds,
      ),
    );
    self.postMessage(
      { channels: result },
      { transfer: result.map((c) => c.buffer) },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
