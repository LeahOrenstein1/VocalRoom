/** Conservative, local noise reduction. Never receives or modifies the source AudioBuffer. */
export function reduceNoise(
  samples: Float32Array,
  sampleRate: number,
  strength: number,
  progress: (value: number) => void = () => {},
  noiseProfileSeconds = 0,
) {
  if (strength <= 0) return samples.slice();
  const n = 1024,
    hop = 256,
    bins = n / 2 + 1;
  const window = Float32Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n),
  );
  const real = new Float64Array(n),
    imag = new Float64Array(n);
  function fft(inverse = false) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const angle = ((inverse ? 2 : -2) * Math.PI) / size,
        wr = Math.cos(angle),
        wi = Math.sin(angle);
      for (let base = 0; base < n; base += size) {
        let ur = 1,
          ui = 0;
        for (let j = 0; j < size / 2; j++) {
          const a = base + j,
            b = a + size / 2,
            tr = real[b] * ur - imag[b] * ui,
            ti = real[b] * ui + imag[b] * ur;
          real[b] = real[a] - tr;
          imag[b] = imag[a] - ti;
          real[a] += tr;
          imag[a] += ti;
          const next = ur * wr - ui * wi;
          ui = ur * wi + ui * wr;
          ur = next;
        }
      }
    }
    if (inverse)
      for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] /= n;
      }
  }
  function frame(start: number) {
    for (let j = 0; j < n; j++) {
      real[j] = (samples[start + j] || 0) * window[j];
      imag[j] = 0;
    }
    fft();
  }
  // Estimate the noise spectrum from the quietest sampled windows, rather than assuming the intro is silent.
  const candidates: { start: number; energy: number }[] = [];
  const profileLength =
    noiseProfileSeconds > 0
      ? Math.min(
          samples.length,
          Math.max(n, Math.floor(noiseProfileSeconds * sampleRate)),
        )
      : samples.length;
  const count = Math.min(160, Math.max(1, Math.floor(profileLength / hop)));
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i / count) * Math.max(1, profileLength - n));
    let energy = 0;
    for (let j = 0; j < n; j++) energy += (samples[start + j] || 0) ** 2;
    candidates.push({ start, energy });
  }
  candidates.sort((a, b) => a.energy - b.energy);
  const selected =
    noiseProfileSeconds > 0
      ? candidates
      : candidates.slice(0, Math.max(1, Math.ceil(count * 0.2)));
  const noise = new Float64Array(bins);
  for (const { start } of selected) {
    frame(start);
    for (let k = 0; k < bins; k++)
      noise[k] += (real[k] ** 2 + imag[k] ** 2) / selected.length;
  }
  // A power cap keeps a continuously sustained sung note from becoming the learned noise profile.
  const cap = noiseProfileSeconds > 0 ? Infinity : ((0.008 * n) / 2) ** 2;
  for (let k = 0; k < bins; k++) noise[k] = Math.min(noise[k], cap);
  const output = new Float32Array(samples.length),
    weight = new Float32Array(samples.length);
  const previous = new Float64Array(bins).fill(1);
  const frames = Math.ceil((samples.length + n) / hop);
  for (let f = 0; f < frames; f++) {
    const start = f * hop - n;
    frame(start);
    for (let k = 0; k < bins; k++) {
      const power = real[k] ** 2 + imag[k] ** 2;
      const spectralGain = Math.max(
        1 - 0.88 * strength,
        Math.sqrt(
          Math.max(0, 1 - ((1 + strength) * noise[k]) / Math.max(1e-15, power)),
        ),
      );
      const frequency = (k * sampleRate) / n;
      const rumble = frequency < 70 ? Math.max(0.05, frequency / 70) : 1;
      const target = spectralGain * (1 - strength + strength * rumble);
      const gain =
        target > previous[k] ? target : 0.75 * previous[k] + 0.25 * target;
      previous[k] = gain;
      real[k] *= gain;
      imag[k] *= gain;
      if (k > 0 && k < n / 2) {
        real[n - k] *= gain;
        imag[n - k] *= gain;
      }
    }
    fft(true);
    for (let j = 0; j < n; j++) {
      const i = start + j;
      if (i >= 0 && i < samples.length) {
        output[i] += real[j] * window[j];
        weight[i] += window[j] ** 2;
      }
    }
    if (f % 100 === 0) progress(f / frames);
  }
  for (let i = 0; i < output.length; i++)
    output[i] = weight[i] > 1e-8 ? output[i] / weight[i] : samples[i];
  progress(1);
  return output;
}
