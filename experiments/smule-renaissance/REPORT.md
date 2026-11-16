# Quality and feasibility report — 2026-11-16

## Decision

**Keep this as an experiment. Do not replace Studio Polish or claim a quality improvement yet.** Actual official pretrained inference succeeded on a user-authorized dry vocal from a saved VocalRoom project. Four real listening outputs exist locally. Naturalness, metallic artifacts, noise/reverb removal, vibrato, dynamics, breaths and consonants still require listening assessment; no listening verdict is fabricated here. One 20-second passage is insufficient to validate a professional restoration product.

## Verified model and licenses

Official source revision: `b80e3a69c347f1290e62dddcb8e069654825aa7b`.
Official weight revision: `12024e3250ace99e566662a2963e6158d104e69c`.
Checkpoint SHA-256: `dd73b487ed058fdea66a25915f9f5a50b3d2dd97c03480f268a1d50a00fe2b06`.
Size: 42,064,415 bytes. Parameters: 10,373,078.

The actual source and weight LICENSE files are both MIT, copyright 2025 smulelabs, and are retained in `licenses/`. Commercial use, modification and redistribution are permitted with their notices. This does not license a user's recording or backing music. No model/audio is published with this repository.

## Actual audio run

Input: a separate dry vocal stem selected by the user, from 25–45 seconds of their saved project; separate backing added only after model inference. Input 44.1 kHz; inference/output 48 kHz mono vocals. Pairwise integrated loudness matching, equal timeline length, no tempo conversion. The final run used a measured four-sample correction (0.083 ms); raw unshifted output is retained. A generative result can have local phase changes despite global alignment.

Windows x64, Intel Family 6 Model 154 CPU, Python 3.12.6, torch/torchaudio 2.7.1+cpu, four inference threads:

| Measurement | Result |
| --- | --- |
| Audio duration | 20.000 s / 960,000 frames before and after |
| Inference runs | 5.657 s; 5.511 s |
| Median / real-time factor | 5.584 s / 0.279 |
| Model load | 0.190 s |
| Sampled peak process RSS | 965,779,456 bytes (~921 MiB) |
| RSS increase during inference | 598,298,624 bytes |
| Global correlation | 0.752 |
| Solo pair loudness | both approximately −34.056 LUFS |
| Mix pair loudness | both approximately −26.939 LUFS |

These measurements establish successful inference and performance for this passage and machine. They do not measure perceptual quality, certify a broadcast meter, or predict whole-song/browser memory. A separate three-second synthetic smoke test also succeeded but is not singing evidence.

| Listening criterion | Current evidence / required decision |
| --- | --- |
| Natural timbre | Pending A/B listening; prefer the original if its identity is damaged |
| Metallic or robotic artifacts | Pending; listen especially at quiet phrase tails |
| Room reverb | Pending; compare gaps and vowel tails without confusing quieter gain with cleanup |
| Background noise | Pending; no clean reference or measured noise-only interval was selected |
| Vibrato | Pending; compare sustained notes and transitions |
| Dynamics | Pending; matched LUFS does not establish preserved phrase dynamics |
| Breaths and consonants | Pending; check attacks, sibilants, breaths and word clarity |

The local `report.json` records provenance and gain/alignment details. Personal input hashes, files and reports are ignored by Git. Ask the recording owner to compare all four files before deciding whether this model meets the need. If it sounds less natural, record that as a failed quality experiment, even if noise is reduced.

## Actual ONNX and browser results

The unmodified spectral network exports to ONNX opset 17 with a dynamic time axis. ONNX checker and native ORT CPU inference succeed at 48 and 73 frames. Export size: 42,978,556 bytes. Operators: Add, Cast, Concat, Constant, Conv, Div, Gather, Identity, Log, MatMul, Mul, Pow, ReduceMean, ReduceSum, Reshape, Shape, Sigmoid, Slice, Softmax, Split, Sqrt, Squeeze, Transpose, Unsqueeze. No export operator blocked this spectral-only probe. Whole audio/STFT export was not attempted; this boundary deliberately keeps FFT outside the graph.

Native ORT CPU relative RMS error versus PyTorch: .000303 and .000307; max absolute error ~.00556 and .00603 on synthetic input. Internal half-precision normalization means bit-identical results are not expected; listening parity on real audio still needs testing.

Actual ONNX Runtime Web 1.22.0, in-app Chrome 157 on this Windows computer, single WASM thread, no cross-origin isolation, synthetic `[1,2049,48,2]` spectrum (~2 seconds):

| Provider | Load incl. fetch | Inference | Relative RMS error vs PyTorch | Outcome |
| --- | --- | --- | --- | --- |
| WASM | 9.235 s | 2.147 s | .000281 | Finite, plausible numerical parity for this fixture |
| WebGPU | 6.374 s | 2.446 s | 1.000000 | **Numerically invalid; reject this path** |

WebGPU did not throw an unsupported-operator error, but its max absolute error was 7.817 and RMS error .14594 versus the reference. Successful session creation is not successful model execution. The precise failing operator/driver interaction has not been isolated; blaming a particular operator would be speculation. WASM is the only currently promising browser backend from this probe.

Reported JS heap was ~68.6 MB for WASM and ~75.9 MB for WebGPU. **These exclude WASM linear memory/GPU allocations and are not total browser memory.** Full browser-process memory, long audio, cancellation, mobile devices, STFT/HP/resampling parity, chunk boundaries, actual restored-waveform listening and UI responsiveness remain unmeasured. The 20-second native RSS is a strong reason to avoid whole-song allocation in a tab.

## Concrete integration plan, conditional on listening approval

1. Finish owner/listener A/B review of real singing, with quiet/loud passages, sustained vibrato and breaths. Include multiple recordings and headphones; reject recordings made worse. Keep per-take original/restored choice.
2. Build an isolated Web Worker prototype using ORT WASM, downloadable MIT model cached locally after an explicit first download. Keep network/sample-rate handling and preprocessing outside the inference graph. Port exact 48 kHz resampling, 60 Hz filter, 4096/2048 STFT and iSTFT, boundary padding, peak scale and sample cropping; compare PCM to Python on real audio. No production switch yet.
3. Determine the temporal receptive field, then validate overlap/context chunk sizes by comparing them with full-pass PyTorch on phrase boundaries. Measure latency, peak WASM/process memory and cancellation for whole songs; do not claim arbitrary chunking is equivalent for a noncausal network.
4. Establish explicit numerical and perceptual acceptance thresholds; run desktop/mobile WASM tests, silence/odd-length files, clipping, denoise failure cases, offline cache and repeated jobs. Use progress, bounded buffers and release sessions between jobs. Add cross-origin isolation only after auditing hosting/dependencies; current single-thread performance is the measured baseline.
5. Investigate WebGPU separately with per-layer comparisons and driver/version coverage. Keep it disabled until its current parity failure is resolved and real-audio outputs pass. Do not automatically route users to it just because `navigator.gpu` exists.
6. Only then integrate an optional offline **vocal restoration** stage followed by the existing mix engine. Retain originals, existing DSP fallback, immutable cache signatures, project compatibility, exports and Git history. Pause 3D animation during heavy work and never compete with real-time capture. Ship MIT notices with any redistributed model; audit ORT/dependency licenses too.

Browser integration is plausible via WASM, but **not ready for production**. Both the listening decision and the full audio browser prototype remain gates.
