/** Deterministic, model-free offline DSP. Used in a Worker and in signal tests. */
export const clamp = (x: number, low: number, high: number) =>
  Math.min(high, Math.max(low, x));
const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x));
const linear = (x: number) => 10 ** (x / 20);
export interface Spectrum {
  rumble: number;
  body: number;
  presence: number;
  harshness: number;
  sibilance: number;
}
export interface SignalAnalysis {
  rms: number;
  activeRms: number;
  peak: number;
  crestDb: number;
  dynamicRangeDb: number;
  bands: Spectrum;
  activity: Float32Array;
  hopSeconds: number;
  lufsEstimate: number | null;
}
export interface VocalPlan {
  highpassHz: number;
  bodyDb: number;
  presenceDb: number;
  harshnessDb: number;
  compressionThresholdDb: number;
  ratio: number;
  staticGainDb: number;
  maxRideDb: number;
  maxDeessDb: number;
  saturationDrive: number;
}
export interface MasterReport {
  inputLufsEstimate: number | null;
  outputLufsEstimate: number | null;
  normalizationDb: number;
  samplePeak: number;
  reconstructionPeak4x: number;
  maxLimiterReductionDb: number;
}
export interface ProductionReport {
  engine: "studio-v1";
  vocals: { id: string; analysis: SignalAnalysis; plan: VocalPlan }[];
  maskingCutDb: number;
  master: MasterReport;
  originalComparisonGain: number;
  processedComparisonGain: number;
}
type FilterKind = "highpass" | "lowpass" | "bandpass" | "peaking" | "highshelf";
export function biquad(
  kind: FilterKind,
  rate: number,
  hz: number,
  q = 0.707,
  gainDb = 0,
) {
  const w = (2 * Math.PI * clamp(hz, 10, rate * 0.45)) / rate,
    c = Math.cos(w),
    s = Math.sin(w),
    a = s / (2 * q),
    A = 10 ** (gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === "peaking") {
    b0 = 1 + a * A;
    b1 = -2 * c;
    b2 = 1 - a * A;
    a0 = 1 + a / A;
    a1 = -2 * c;
    a2 = 1 - a / A;
  } else if (kind === "highshelf") {
    const r = 2 * Math.sqrt(A) * a;
    b0 = A * (A + 1 + (A - 1) * c + r);
    b1 = -2 * A * (A - 1 + (A + 1) * c);
    b2 = A * (A + 1 + (A - 1) * c - r);
    a0 = A + 1 - (A - 1) * c + r;
    a1 = 2 * (A - 1 - (A + 1) * c);
    a2 = A + 1 - (A - 1) * c - r;
  } else {
    a0 = 1 + a;
    a1 = -2 * c;
    a2 = 1 - a;
    if (kind === "highpass") {
      b0 = (1 + c) / 2;
      b1 = -(1 + c);
      b2 = b0;
    } else if (kind === "lowpass") {
      b0 = (1 - c) / 2;
      b1 = 1 - c;
      b2 = b0;
    } else {
      b0 = a;
      b1 = 0;
      b2 = -a;
    }
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;
  let z1 = 0,
    z2 = 0;
  return (input: number) => {
    const output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    return output;
  };
}
/** K-weighted, gated estimate. Not a certified BS.1770 meter. */
export function loudnessEstimate(
  channels: Float32Array[],
  rate: number,
): number | null {
  const length = channels[0]?.length ?? 0;
  if (!length) return null;
  const hop = Math.max(1, Math.round(rate * 0.1)),
    energies = new Float64Array(Math.ceil(length / hop));
  for (const samples of channels) {
    const shelf = biquad("highshelf", rate, 1681.974, 0.707, 4),
      hp = biquad("highpass", rate, 38.135, 0.5003);
    for (let i = 0; i < length; i++) {
      const value = hp(shelf(Number.isFinite(samples[i]) ? samples[i] : 0));
      energies[Math.floor(i / hop)] += (value * value) / hop;
    }
  }
  const blocks: number[] = [];
  for (let i = 0; i < energies.length; i++) {
    const width = Math.min(4, energies.length - i);
    let energy = 0;
    for (let j = 0; j < width; j++) energy += energies[i + j];
    energy /= width;
    if (-0.691 + 10 * Math.log10(Math.max(1e-20, energy)) > -70)
      blocks.push(energy);
  }
  if (!blocks.length) return null;
  const absolute = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const gated = blocks.filter((e) => e >= absolute * 0.1);
  return (
    -0.691 + 10 * Math.log10(gated.reduce((a, b) => a + b, 0) / gated.length)
  );
}
export function analyzeSignal(
  channels: Float32Array[],
  rate: number,
  start = 0,
  end = channels[0]?.length ?? 0,
): SignalAnalysis {
  const count = channels.length,
    hop = Math.max(1, Math.round(rate * 0.05));
  start = clamp(Math.floor(start), 0, end);
  end = Math.min(end, channels[0]?.length ?? 0);
  const activity = new Float32Array(
    Math.max(1, Math.ceil((end - start) / hop)),
  );
  let peak = 0,
    sum = 0;
  const totals = {
    rumble: 0,
    body: 0,
    presence: 0,
    harshness: 0,
    sibilance: 0,
  };
  const bandKeys: (keyof Spectrum)[] = [
    "rumble",
    "body",
    "presence",
    "harshness",
    "sibilance",
  ];
  for (const data of channels) {
    const filters = {
      rumble: biquad("lowpass", rate, 85),
      body: biquad("bandpass", rate, 250, 0.75),
      presence: biquad("bandpass", rate, 2800, 0.8),
      harshness: biquad("bandpass", rate, 4400, 1.1),
      sibilance: biquad("bandpass", rate, 7200, 0.9),
    };
    for (let i = start; i < end; i++) {
      const x = Number.isFinite(data[i]) ? data[i] : 0;
      sum += x * x;
      peak = Math.max(peak, Math.abs(x));
      activity[Math.floor((i - start) / hop)] += (x * x) / (hop * count);
      for (const key of bandKeys) {
        const y = filters[key](x);
        totals[key] += y * y;
      }
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, (end - start) * count));
  for (let i = 0; i < activity.length; i++)
    activity[i] = Math.sqrt(activity[i]);
  const active = Array.from(activity)
    .filter((x) => x > Math.max(0.0001, rms * 0.12))
    .sort((a, b) => a - b);
  const activeRms = active.length
    ? Math.sqrt(active.reduce((s, x) => s + x * x, 0) / active.length)
    : 0;
  const dynamicRangeDb =
    active.length > 1
      ? db(active[Math.floor((active.length - 1) * 0.9)]) -
        db(active[Math.floor((active.length - 1) * 0.1)])
      : 0;
  const bands = Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [
      k,
      sum > 1e-16 ? clamp(v / sum, 0, 1) : 0,
    ]),
  ) as unknown as Spectrum;
  return {
    rms,
    activeRms,
    peak,
    crestDb: rms > 1e-12 ? db(peak / rms) : 0,
    dynamicRangeDb,
    bands,
    activity,
    hopSeconds: hop / rate,
    lufsEstimate: loudnessEstimate(
      channels.map((c) => c.subarray(start, end)),
      rate,
    ),
  };
}
export function vocalPlan(
  a: SignalAnalysis,
  preset: string,
  intensity: number,
): VocalPlan {
  const amount = clamp(intensity, 0, 1),
    warm = preset === "Warm Studio",
    pop = preset === "Pop Vocal";
  return {
    highpassHz: a.bands.rumble > 0.18 ? 85 : 55,
    bodyDb:
      -clamp((a.bands.body - 0.35) * 5, 0, 2) * amount +
      (warm ? 0.5 * amount : 0),
    presenceDb:
      clamp((0.18 - a.bands.presence) * 8, -1.2, pop ? 2 : 1.3) * amount,
    harshnessDb: -clamp((a.bands.harshness - 0.12) * 8, 0, 2.5) * amount,
    compressionThresholdDb: clamp(db(a.activeRms) - 5, -32, -15),
    ratio: 1 + (pop ? 2 : 1.4) * amount,
    staticGainDb:
      a.activeRms > 1e-5 ? clamp(db(0.12 / a.activeRms), -6, 6) * amount : 0,
    maxRideDb: 3 * amount,
    maxDeessDb: (pop ? 5 : 4) * amount,
    saturationDrive: warm || pop ? 1 + 0.18 * amount : 1,
  };
}
export function processVocal(
  channels: Float32Array[],
  rate: number,
  plan: VocalPlan,
  intensity: number,
  onProgress: (p: number) => void = () => {},
) {
  if (intensity <= 0) return channels.map((c) => c.slice());
  const output = channels.map((c) => new Float32Array(c.length));
  if (!channels.length) return output;
  const filters = channels.map(() => ({
    hp: biquad("highpass", rate, plan.highpassHz),
    body: biquad("peaking", rate, 250, 0.8, plan.bodyDb),
    presence: biquad("peaking", rate, 2800, 0.75, plan.presenceDb),
    harsh: biquad("peaking", rate, 4400, 1.2, plan.harshnessDb),
    high: biquad("highpass", rate, 4800),
  }));
  const length = channels[0].length,
    filtered = new Float64Array(channels.length),
    highs = new Float64Array(channels.length);
  let slowEnergy = 0,
    fastEnergy = 0,
    highEnergy = 0,
    ride = 1,
    deess = 1,
    compression = 1;
  const slow = Math.exp(-1 / (rate * 0.22)),
    fast = Math.exp(-1 / (rate * 0.012)),
    rideSpeed = Math.exp(-1 / (rate * 0.15)),
    deessAttack = Math.exp(-1 / (rate * 0.002)),
    deessRelease = Math.exp(-1 / (rate * 0.07)),
    compAttack = Math.exp(-1 / (rate * 0.018)),
    compRelease = Math.exp(-1 / (rate * 0.18));
  const staticGain = linear(plan.staticGainDb),
    amount = clamp(intensity, 0, 1);
  for (let i = 0; i < length; i++) {
    let energy = 0,
      highPower = 0;
    for (let c = 0; c < channels.length; c++) {
      const f = filters[c];
      const x = f.harsh(f.presence(f.body(f.hp(channels[c][i] || 0))));
      filtered[c] = x;
      highs[c] = f.high(x);
      energy += (x * x) / channels.length;
      highPower += highs[c] ** 2 / channels.length;
    }
    slowEnergy = slow * slowEnergy + (1 - slow) * energy;
    fastEnergy = fast * fastEnergy + (1 - fast) * energy;
    highEnergy = fast * highEnergy + (1 - fast) * highPower;
    const level = Math.sqrt(slowEnergy),
      wantedRide =
        level > 0.008
          ? linear(
              clamp(
                db(0.12 / (level * staticGain)),
                -plan.maxRideDb,
                plan.maxRideDb,
              ),
            )
          : 1;
    ride = rideSpeed * ride + (1 - rideSpeed) * wantedRide;
    const sibilantRatio = highEnergy / Math.max(1e-12, fastEnergy),
      wantedDeess =
        highEnergy > 0.00008
          ? linear(
              -plan.maxDeessDb * clamp((sibilantRatio - 0.25) / 0.45, 0, 1),
            )
          : 1;
    const ds = wantedDeess < deess ? deessAttack : deessRelease;
    deess = ds * deess + (1 - ds) * wantedDeess;
    const inputDb = db(Math.sqrt(fastEnergy) * staticGain * ride),
      over = inputDb - plan.compressionThresholdDb,
      knee = 6;
    let reduction = 0;
    if (over > knee / 2) reduction = (1 - 1 / plan.ratio) * over;
    else if (over > -knee / 2)
      reduction = ((1 - 1 / plan.ratio) * (over + knee / 2) ** 2) / (2 * knee);
    const wantedComp = linear(-reduction),
      cs = wantedComp < compression ? compAttack : compRelease;
    compression = cs * compression + (1 - cs) * wantedComp;
    for (let c = 0; c < channels.length; c++) {
      let x =
        (filtered[c] + highs[c] * (deess - 1)) *
        staticGain *
        ride *
        compression;
      if (plan.saturationDrive > 1)
        x = Math.tanh(x * plan.saturationDrive) / plan.saturationDrive;
      output[c][i] = Number.isFinite(x) ? x : 0;
    }
    if (i % 65536 === 0) onProgress(i / length);
  }
  onProgress(1);
  return output;
}
/** 4x windowed-sinc reconstruction estimate. This is not a certified true-peak test. */
export function reconstructionPeak4x(channels: Float32Array[]) {
  const radius = 8,
    kernels = [0.25, 0.5, 0.75].map((phase) => {
      const weights = [];
      let sum = 0;
      for (let tap = -radius + 1; tap <= radius; tap++) {
        const d = phase - tap;
        const sinc =
          Math.abs(d) < 1e-10 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
        const window =
          Math.abs(d) < radius
            ? 0.5 + 0.5 * Math.cos((Math.PI * d) / radius)
            : 0;
        weights.push(sinc * window);
        sum += weights[weights.length - 1];
      }
      return weights.map((x) => x / sum);
    });
  let peak = 0;
  for (const samples of channels)
    for (let i = 0; i < samples.length; i++) {
      peak = Math.max(peak, Math.abs(samples[i]));
      for (const kernel of kernels) {
        let sum = 0;
        for (let tap = 0; tap < kernel.length; tap++)
          sum += (samples[i + tap - radius + 1] || 0) * kernel[tap];
        peak = Math.max(peak, Math.abs(sum));
      }
    }
  return peak;
}
export function masterSignal(
  input: Float32Array[],
  rate: number,
  onProgress: (p: number) => void = () => {},
) {
  const channels = input.map((c) =>
      Float32Array.from(c, (x) => (Number.isFinite(x) ? x : 0)),
    ),
    length = channels[0]?.length ?? 0,
    inputLufsEstimate = loudnessEstimate(channels, rate);
  const normalizationDb =
      inputLufsEstimate === null ? 0 : clamp(-16 - inputLufsEstimate, -12, 6),
    gain = linear(normalizationDb);
  for (const channel of channels)
    for (let i = 0; i < length; i++) channel[i] *= gain;
  const lookahead = Math.max(1, Math.round(rate * 0.005)),
    peaks = new Float32Array(length),
    future = new Float32Array(length),
    deque = new Int32Array(length);
  let head = 0,
    tail = 0;
  for (let i = length - 1; i >= 0; i--) {
    let p = 0;
    for (const channel of channels) p = Math.max(p, Math.abs(channel[i]));
    peaks[i] = p;
    while (tail > head && peaks[deque[tail - 1]] <= p) tail--;
    deque[tail++] = i;
    while (tail > head && deque[head] > i + lookahead) head++;
    future[i] = peaks[deque[head]];
  }
  const ceiling = 0.94,
    attack = Math.exp(-1 / (rate * 0.0006)),
    release = Math.exp(-1 / (rate * 0.09));
  let envelope = 1,
    minGain = 1;
  for (let i = 0; i < length; i++) {
    const wanted = Math.min(1, ceiling / Math.max(1e-12, future[i])),
      coefficient = wanted < envelope ? attack : release;
    envelope = coefficient * envelope + (1 - coefficient) * wanted;
    const linked = Math.min(envelope, ceiling / Math.max(1e-12, peaks[i]));
    minGain = Math.min(minGain, linked);
    for (const channel of channels) channel[i] *= linked;
    if (i % 65536 === 0) onProgress((0.5 * i) / Math.max(1, length));
  }
  let reconstructed = reconstructionPeak4x(channels);
  const guard = reconstructed > 0.97 ? 0.97 / reconstructed : 1;
  let samplePeak = 0;
  for (const channel of channels)
    for (let i = 0; i < length; i++) {
      channel[i] *= guard;
      samplePeak = Math.max(samplePeak, Math.abs(channel[i]));
    }
  const report: MasterReport = {
    inputLufsEstimate,
    outputLufsEstimate: loudnessEstimate(channels, rate),
    normalizationDb,
    samplePeak,
    reconstructionPeak4x: reconstructed * guard,
    maxLimiterReductionDb: Math.max(0, -db(minGain * guard)),
  };
  onProgress(1);
  return { channels, report };
}
