# Audio quality and local model roadmap

## What is running now

VocalRoom v0.2.0 uses **no neural model**. There are no OpenAI, paid AI, cloud audio, or inference API calls. It runs local DSP: STFT noise reduction (automatic noise spectrum or a user-supplied noise-only intro), rumble reduction, vocal high-pass/EQ/compression/gain/reverb, group balance, bus compression, and output peak attenuation. Audio assets stay in browser memory/IndexedDB. GitHub contains source code, not the user's recordings.

This does not establish what the user's separate ChatGPT or GitHub account may cost; VocalRoom itself provisions no paid service. No GitHub Actions, Codespaces, external inference, or hosting resources are configured.

## Synchronization changes

The previous prototype recorded with MediaRecorder while playing backing audio in a separate Web Audio scheduling path. Codec framing and startup timing made alignment less deterministic; hardware input/output delay is another independent source of a constant offset. We have not established which caused the user's observed mismatch.

New recordings use a PCM AudioWorklet attached to the same AudioContext as playback. Both are armed for the same future audio-frame timestamp, and PCM is stored at that context's actual sample rate. Missing input blocks are represented by silence instead of shortening the recording. UI timers only display position; they do not determine captured duration. This removes the codec conversion path from new captures. Existing takes are not automatically time-stretched or pitch-shifted.

Hardware latency still requires a device check. Auto delay correction estimates baseLatency + outputLatency + input track latency where available, capped at one second. It is an estimate, not a measured loopback calibration. Recording delay correction (ms) accepts a manual override; an empty value returns to Auto. Each vocal take also has Earlier/Later 10 ms controls under Timing & cleanup. Prefer wired headphones for repeatable timing; Bluetooth delay can vary.

## Improvements within the current DSP design

For a recording with a room-noise-only introduction, open Timing & cleanup and set Noise-only intro (s) to its length. A value of zero keeps the automatic quiet-window estimate. Never include singing in the explicit noise profile. Process the session again, compare to Original, and lower strength if vocal texture is damaged. Neither mode can reliably remove a competing voice that overlaps the wanted singing.

## Free model candidates (researched 2026-11-16; not installed)

| Candidate     | Primary source and license                                                                                                                  | Fit and unresolved work                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNNoise       | [Xiph repository](https://github.com/xiph/rnnoise), [BSD-3-Clause license](https://github.com/xiph/rnnoise/blob/main/COPYING)               | RNN-based noise suppression. Training instructions use clean speech and noise at 48 kHz. A WASM build is a candidate for optional local use; validate preservation of quiet phrases, vibrato, held notes, and breaths before adopting it for singing.                               |
| DeepFilterNet | [Official repository](https://github.com/Rikorose/DeepFilterNet), its License section states code and model weights are dual MIT/Apache-2.0 | Full-band 48 kHz speech enhancement. Evaluate an optional offline local denoiser, with explicit model/version/license checks, reproducible WASM/ONNX conversion, and browser CPU/memory measurements. The official Python/Rust implementation is not a drop-in browser integration. |

Both projects focus on speech. Singing suitability is an inference to test, not a proven property or a reason to silently replace the current DSP. A model being open source does not guarantee better results on singing. Avoid selecting a third-party browser wrapper solely because it advertises AI; inspect its model provenance, redistribution rights, quality, and network behavior first.

## Adoption gate for a later version

1. Establish a consented, local test set: clean singing plus controlled fan/hum/noise, quiet and loud voices, held vowels, breaths, and headphone leakage. Keep originals and compare at matched loudness.
2. Benchmark the present DSP against pinned RNNoise and DeepFilterNet builds locally. Measure residual noise, damage to wanted vocals, alignment, render time, peak output, and RAM on target devices.
3. Make neural denoising optional and off by default until listening tests support it. Bundle or explicitly download verified model files; never upload audio for inference.
4. Preserve bypass and source PCM. If the model fails or performs poorly, fall back to the existing local DSP with a clear message.
5. Treat overlapping speaker/singer isolation as a separate research task, rather than claiming general denoising solves it.
