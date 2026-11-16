# VocalRoom

A free, private browser recording studio. All audio stays on your device. No backend, API keys, accounts, paid services, or external audio processing.

## Run

Use Node.js 22 or newer:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173 in desktop Chrome. Microphone access requires localhost or HTTPS. `npm run build` creates `dist/`.

## Workflow

1. Start Creating → choose Natural, Warm Studio, or Pop Vocal → Enter the Studio.
2. Optionally import an MP3/WAV after confirming you have permission. You can also record with no backing track.
3. Put on headphones. Choose any point with the playhead or Record from (seconds), then record a take after the three-second countdown. Existing unmuted tracks play for overdubbing; the microphone remains separate. Stop, listen, and record additional takes. Mute unwanted takes; multiple unmuted takes play together.
4. Adjust volume, pan, trim, and sync in milliseconds. Negative sync advances a take; positive sync delays it. Use mute/solo to compare takes.
5. Choose character, intensity, noise reduction, and full-mix balance, then apply Make My Voice Sound Professional. Actual processing stages are displayed: analysis, local noise reduction, balancing, and final rendering. Listen to original and Listen to processed switch at the same timeline position during playback. Seeking and changing track sync also keep playback running; no source audio is overwritten. Changing an edit or effect setting makes the previous processed mix stale and switches back to originals until you process again.
6. Save the project in this browser, or export the actual stereo mix as 16-bit, 44.1 kHz WAV. The selected Original/Processed version is exported and named accordingly. My projects reopens original tracks and the separate processed mix, and now includes New Project directly in the library. New Project starts an independent session with a new project ID and offers Save & start new. Reset project clears only the active session after confirmation; saved projects remain available.

## Studio Polish (Phase 1 upgrade)

New sessions use adaptive local DSP: analysis-based vocal EQ, de-essing, soft-knee compression, slow gain riding, preset-dependent mild saturation, natural reverb, optional short stereo delay, backing-aware masking EQ, and stereo-linked master peak protection. Original/processed comparison can match listening levels without changing exports. Advanced controls retain Classic DSP as a fallback, and older projects keep their Classic settings and cached results.

See [Phase 1 architecture, tests, limitations, and local listening procedure](docs/PHASE1_AUDIO_ENGINE.md). No neural model or pitch correction is introduced. Loudness and 4x reconstruction peaks are estimates; no certified true-peak compliance or studio-quality listening result is claimed.

## Implementation

React/TypeScript/Vite, Tailwind CSS, Motion, Three.js and React Three Fiber. The microphone is original procedural geometry, with no external model or attribution requirement. It uses reflective metallic materials, generated studio lighting, a glowing ring, damped spring rotation, and idle floating. The scene is lazy-loaded and unmounted outside Home. Reduced-motion preferences disable floating and use demand rendering; unsupported WebGL uses a static CSS microphone.

Web Audio handles separate microphone takes and backing tracks. A PCM AudioWorklet captures only microphone input on the same AudioContext clock as the backing tracks; no live mic monitoring is connected, preventing software feedback. OfflineAudioContext renders the processed mix using a real DSP graph: high-pass filtering, preset EQ, compression, RMS-based gain, convolution reverb, master headroom and compressor peak control. These are real DSP algorithms, not neural AI. Waveforms come from decoded PCM. A Web Worker applies conservative STFT spectral noise reduction to copies of vocal PCM, including rumble attenuation, then the full mix receives group-level balancing, bus compression, and peak protection. Playback of the processed version and processed export use the same cached final AudioBuffer. Original waveforms always show source recordings. IndexedDB stores exact float PCM, sample rates, project settings, and the separate processed mix. A Noise-only intro (s) setting under Timing & cleanup can learn a real room-noise profile instead of automatic estimation. The earlier WAV project format is still readable.

## Validation

`npm test` checks exact sample-clock capture at both 44.1/48 kHz, WAV encoding, timeline duration, and noise reduction (noise attenuation, harmonic preservation, unchanged originals, bypass, and silence). `npm run build` checks TypeScript and makes the production bundle. Open `/tests/audio.html` on the dev server and run the browser audio checks: real offline rendering, trimming/sync, mute/solo, DSP differences, WAV headers, and IndexedDB round-trip using generated tones. The browser suite also checks genuine worker processing stages, original PCM preservation, backing-track inclusion, processing cancellation, processed-cache invalidation, and exact PCM project round-trip. Open `/tests/studio.html` for an explicit synthetic microphone fixture using the actual PCM AudioWorklet and app UI. This tests nonzero-offset recording without backing, live seeking/sync, A/B listening, processing, saving, reset, and reopen without accessing real microphone hardware. Open `/tests/capture.html` to verify actual AudioWorklet frame counts and duration in the browser. Test fixtures contain no copyrighted recordings and are not included in the production bundle.

## Limitations / hardware checks

- Test real microphone permission, input selection, capture quality, headphone leakage, and synchronization with actual hardware. Device input/output latency varies. Use Recording delay correction (ms), or the Earlier/Later 10 ms controls under Timing & cleanup. New recordings use the playback clock and actual context sample rate; existing recordings are not time-stretched. Device names become available after microphone permission is granted.
- Noise reduction is conservative DSP, not source separation: overlapping background speech, music leakage, or reverb may remain. Strong reduction may affect vocal texture; lower the amount and compare against Original. No neural denoising model ships in this release. See [audio quality and free model roadmap](docs/AI_AUDIO_ROADMAP.md) for the current DSP behavior, verified RNNoise/DeepFilterNet sources and licenses, and the singing-quality evaluation plan. Next step: evaluate a license-compatible singing-preserving ONNX/WASM model with real singing samples, CPU budgets, and model redistribution/license review. Do not label the current DSP as AI.
- Classic DSP retains its original sample-peak attenuation. Studio Polish adds a linked lookahead limiter and an actual 4x reconstruction peak estimate, with final linked attenuation below 0.97 by that estimator. The interpolation filter and loudness estimate are not certified for broadcast/true-peak compliance.
- Long recordings and offline rendering use browser RAM. Imports are limited to 120 MB each. Browser storage quota varies; errors are reported. Clearing browser data removes saved projects. Keep exported copies and originals. New project saves preserve exact float PCM and require more storage than a compressed recording. WAV export remains 16-bit PCM.
- No pitch correction, tempo detection, destructive editing, automatic latency calibration, MP3 export, or undo history. Edits are nondestructive until exporting; removed tracks can be recovered from the last saved project.
- Fonts are bundled locally under their open font licenses. The running app needs no external font, model, or audio service.

## Free static deployment (optional)

Build with `npm run build`, then upload the contents of `dist/` to a free static host such as Cloudflare Pages (Direct Upload). No Workers, R2, database, bindings, API keys, or paid plan are needed for the app. HTTPS is required for microphone access. Review the host's current free plan terms before publishing. No hosting resources have been provisioned by this project.


## Studio tools and isolated restoration experiment

See [Studio tools](docs/studio-tools.md) for light mode, splitting, WAV/MP3 and dry vocal stem exports, and measured recording delay. See [Smule experiment](experiments/smule-renaissance/README.md) and its [measured report](experiments/smule-renaissance/REPORT.md) for actual local pretrained inference, verified licenses and ONNX/browser findings. Smule is not integrated into the production audio engine. Personal recordings and experiment outputs remain ignored by Git.
