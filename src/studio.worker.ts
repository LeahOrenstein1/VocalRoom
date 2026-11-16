import {
  analyzeSignal,
  vocalPlan,
  processVocal,
  masterSignal,
} from "./studio-dsp";
self.onmessage = ({ data }) => {
  try {
    const progress = (value: number) => self.postMessage({ progress: value });
    if (data.task === "analyze") {
      self.postMessage({
        result: analyzeSignal(
          data.channels,
          data.sampleRate,
          data.start,
          data.end,
        ),
      });
      return;
    }
    if (data.task === "vocal") {
      const plan = vocalPlan(data.analysis, data.preset, data.intensity);
      const channels = processVocal(
        data.channels,
        data.sampleRate,
        plan,
        data.intensity,
        progress,
      );
      self.postMessage(
        { result: { channels, plan } },
        { transfer: channels.map((c) => c.buffer) },
      );
      return;
    }
    const result = masterSignal(data.channels, data.sampleRate, progress);
    self.postMessage(
      { result },
      { transfer: result.channels.map((c) => c.buffer) },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
