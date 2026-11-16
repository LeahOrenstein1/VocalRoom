# Changelog

## 0.3.0 — 2026-11-16 (Phase 1 upgrade branch)

- Add New Project inside My Projects, reusing the existing save/discard flow.
- Add Studio Polish worker analysis, adaptive vocal EQ/de-essing/compression/riding, conservative backing masking EQ, optional stereo delay, and linked offline mastering.
- Add attenuation-only level-matched A/B listening without changing cached exports.
- Preserve Classic DSP and old project caches; store new production reports separately from original PCM.
- Add synthetic signal and full Worker/render tests, plus a local subjective quality-evaluation procedure. No neural models or pitch correction are introduced.

## 0.2.0 — 2026-11-16

- Record raw PCM on the playback AudioContext clock using AudioWorklet, replacing the codec-dependent MediaRecorder path.
- Schedule recording and backing playback at the same sample-frame timestamp; preserve the actual device context sample rate.
- Add automatic device-delay estimates, a manual recording-delay override, and Earlier/Later 10 ms take alignment.
- Add an optional noise-only intro profile for spectral noise reduction, preserving source PCM and A/B listening.
- Add New Project with save-before-start and discard options, retaining saved sessions.
- Document current DSP behavior, no-model/no-paid-API operation, and free model evaluation candidates.
- Preserve local projects, original/processed listening, multitrack controls, full-mix processing, and WAV export.

The earlier prototype was not committed to this repository. This is the first tracked application release.
