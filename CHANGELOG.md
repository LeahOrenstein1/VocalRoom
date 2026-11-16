# Changelog

## 0.2.0 — 2026-11-16

- Record raw PCM on the playback AudioContext clock using AudioWorklet, replacing the codec-dependent MediaRecorder path.
- Schedule recording and backing playback at the same sample-frame timestamp; preserve the actual device context sample rate.
- Add automatic device-delay estimates, a manual recording-delay override, and Earlier/Later 10 ms take alignment.
- Add an optional noise-only intro profile for spectral noise reduction, preserving source PCM and A/B listening.
- Add New Project with save-before-start and discard options, retaining saved sessions.
- Document current DSP behavior, no-model/no-paid-API operation, and free model evaluation candidates.
- Preserve local projects, original/processed listening, multitrack controls, full-mix processing, and WAV export.

The earlier prototype was not committed to this repository. This is the first tracked application release.
