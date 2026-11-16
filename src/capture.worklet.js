/* Runs on the audio rendering thread. Capture and playback share sample frames. */
class VocalRoomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity;
    this.stopFrame = Infinity;
    this.active = false;
    this.chunk = new Float32Array(4096);
    this.used = 0;
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") {
        this.startFrame = data.frame;
        this.active = true;
      }
      if (data.type === "stop") this.stopFrame = data.frame;
      if (data.type === "dispose") this.active = false;
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.chunk.slice(0, this.used);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.used = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const blockLength = outputs[0]?.[0]?.length || input?.[0]?.length || 128;
    if (!this.active) return true;
    for (let i = 0; i < blockLength; i++) {
      const frame = currentFrame + i;
      if (frame >= this.stopFrame) {
        this.flush();
        this.port.postMessage({ type: "stopped", frames: this.frames });
        this.active = false;
        return true;
      }
      if (frame < this.startFrame) continue;
      // The vocal input is deliberately downmixed to mono, at the context's real sample rate.
      let sample = 0;
      if (input?.length) {
        for (const channel of input) sample += channel[i] || 0;
        sample /= input.length;
      }
      this.chunk[this.used++] = sample;
      this.frames++;
      if (this.used === this.chunk.length) this.flush();
    }
    return true;
  }
}
registerProcessor("vocalroom-pcm-capture", VocalRoomCapture);
