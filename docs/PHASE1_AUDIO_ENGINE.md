# Phase 1: Studio Polish audio engine

## Scope and release status

This upgrade adds a deterministic, browser-local production engine, plus New Project inside My Projects. It retains the interface, 3D microphone, PCM recording clock, multitrack editing, original waveforms, IndexedDB projects, A/B listening, and cached WAV export. No backend, model, paid API, or audio upload is introduced. Neural processing and pitch correction have not been started.

The previous engine remains available as **Advanced controls → Processing engine → Classic DSP (fallback)**. Projects saved before the engine field existed reopen in Classic mode, retaining their cached processed result. New sessions default to Studio Polish. Existing source audio is never overwritten.

## Weaknesses addressed

The previous chain used fixed vocal EQ, whole-buffer RMS for automatic gain, and group RMS targets. There was no de-essing, phrase-level gain riding, backing spectral masking analysis, level-matched A/B comparison, or lookahead stereo master protection. Long pauses could influence the RMS gain decision. The original chain is retained, not removed or silently relabelled as AI.

## Processing architecture

1. **Source snapshot / analysis:** `studio-engine.ts` copies audible track PCM to `studio.worker.ts`. Analysis uses the edited region, not discarded audio outside trim boundaries. It measures RMS, active-frame RMS, sample peak, crest factor, percentile phrase dynamic range, and rumble/body/presence/harshness/sibilance filter-band energy ratios. A gated K-weighted loudness estimate supports final output and comparison levels.
2. **Noise reduction:** The existing dedicated noise Worker runs on copies. It supports the automatic quiet-window estimate and an explicit noise-only introduction. It is not source separation and cannot reliably remove a competing singer or speech overlapping the desired vocal.
3. **Vocal shaping in a Worker:** Cleaned audio is analyzed again. Measurements select a conservative 55–85 Hz high-pass, bounded body/presence/harshness parametric EQ, a fast-attack/slow-release high-band de-esser, phrase-level gain riding bounded to ±3 dB at full intensity, soft-knee compression, and mild saturation for Warm/Pop. Rider smoothing is intentionally much slower than typical vibrato. Zero vocal-processing intensity is an exact independent bypass of these vocal stages; noise reduction and final mixing remain separately controlled.
4. **Backing-aware placement:** Active voice energy and user faders establish conservative group gain adjustments. Shared presence energy can enable a peaking EQ dip on the instrumental, capped at 2 dB before the intensity scale. A smoothed vocal activity envelope drives that dip, so it releases in vocal gaps. No masking EQ is enabled where the proxy does not indicate overlap, when no vocal is audible, or when full-mix balance is disabled. Instrumental user fader/pan/mute/solo/trim values remain untouched.
5. **Offline render:** `audio.ts` renders the actual backing and processed vocals together through OfflineAudioContext. The new vocal signal bypasses the old vocal chain to avoid double EQ/compression/gain. It receives modest, deterministic stereo room reverb and optional 85/115 ms stereo delay without feedback. The existing gentle master bus compressor is retained. Render settings exist only on ephemeral prepared tracks.
6. **Master Worker:** A gated K-weighted loudness estimate sets a bounded normalization gain toward an estimated −16 LUFS target (maximum +6 dB, minimum −12 dB). A 5 ms lookahead, stereo-linked limiter applies the same gain to all channels, with release smoothing and a hard safety bound. Four-times windowed-sinc reconstruction estimates intersample peaks; final linked attenuation protects the measured reconstruction estimate below 0.97. All processing retains buffer length/sample rate and never time-stretches the singer.
7. **Comparison / persistence / export:** An original reference mix is rendered and measured. A/B gains attenuate the louder version to matched estimated listening levels; they do not boost or change exported audio. The user can disable this in Match listening levels. Playback and processed WAV export use the exact cached final PCM. IndexedDB stores original float PCM, engine settings, the report, and final PCM separately. Render-affecting edits invalidate the processed cache; comparison level matching and recording-delay preferences do not.

The expensive analysis, vocal DSP, and mastering loops run in Workers. Transfers use copied typed arrays, so source buffers cannot become detached. Workers are terminated on cancellation; cancellation during native OfflineAudioContext rendering discards the result when that render settles. The main thread only manages buffers, scheduling, and UI progress.

## Measurement limits

- Filter-band ratios are analysis proxies, not perceptual source identification. Phrase dynamic range is a percentile RMS measure, not standardized EBU LRA.
- Loudness is a K-weighted, gated **estimate**, not a certified BS.1770 meter. The −16 target is not guaranteed when gain limits or peak protection take precedence.
- Reconstruction uses real 4× interpolation, but a short 16-tap Hann-windowed sinc is not a certified true-peak filter. Synthetic intersample-peak tests pass; official conformance vectors and higher-factor reference comparisons have not been completed. **No true-peak or broadcast compliance is claimed.**
- Generic automatic settings cannot establish a preferred artistic mix. Room acoustics, mic placement, headphone leakage, overlapping voices, and poor sources can remain audible. Strong denoising can damage singing; compare with Original.
- No singing-quality claim has been validated by a real listening panel. No pitch correction, key detection, or neural model was added.
- Offline copies, reverb, and reconstruction consume RAM and CPU. Ordinary short desktop sessions are the target; long sessions and device-specific performance require additional benchmarks. A generated two-second, two-track integration suite completed in about eight seconds on the current test machine, including several complete renders; this is not a general real-time performance guarantee.

## Automated validation

- `npm test`: existing PCM clock, WAV, noise tests plus new signal tests for band analysis, silence, loudness gain behavior, bypass/source preservation, rumble filtering, selective de-essing, preserved phrase contrast, linked stereo peak protection, and actual intersample-peak reconstruction.
- `/tests/audio.html`: 17 legacy graph, trim/sync, mute/solo, DSP, PCM persistence, cancellation, and export checks.
- `/tests/studio-engine.html`: 11 real Worker/render checks for the new engine, bounded masking EQ, finite stereo PCM, peak protection, matched A/B levels, cached export, saved production reports/source PCM, old project compatibility, cancellation during worker processing, and optional stereo delay.
- `/tests/capture.html`: 3 actual AudioWorklet sample-count/duration checks. The capture implementation is unchanged by this phase.
- Browser UI checks cover New Project from the library, entering an empty studio, preserving existing sessions through the save/discard flow, opening upgraded caches, the collapsed advanced settings, and before/after playback.

These tests use generated signals and never access real microphone hardware or copyrighted music.

## Local subjective evaluation before a studio-quality claim

1. Use singing samples the tester owns or has permission to evaluate. Keep all files local. Include low/high voices, quiet verses, loud phrases, held vowels, vibrato, breaths, strong sibilants, silence, fan/hum, transient room noises, and realistic headphone leakage, plus dry clean references where available.
2. Prepare Original, Classic DSP, and Studio Polish versions from the same edited session. Align them at the same timestamp and use the built-in level-matched comparison. For a blind test, randomize version labels outside the product rather than revealing which should sound better.
3. Score vocal intelligibility, natural timbre, vibrato/expressiveness, sibilance, background noise, pumping, reverb/delay suitability, stereo stability, and vocal/backing balance on a consistent 1–5 scale. Specifically listen to phrase ends and quiet breaths. Record failure timestamps locally.
4. Measure original preservation, timing, output sample and reconstruction peaks, loudness estimate, render duration, and browser RAM. Compare the 4× reconstruction to a longer-kernel, higher-factor reference and official vectors before claiming true-peak compliance.
5. Treat new harshness, lost quiet notes, altered vibrato, audible pumping, stereo movement, or added noise as failures even if overall loudness improves. Change one bounded stage at a time and repeat matched-level listening. Keep Classic available throughout.
6. Only after Phase 1 passes representative real singing tests should a separate Phase 2 experiment evaluate the already documented free neural model candidates. Pitch-correction design remains a later phase.

## References

- [W3C Web Audio specification](https://www.w3.org/TR/webaudio/): native filtering, scheduling, offline contexts, and dynamics nodes.
- [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770/en): authoritative loudness and true-peak specification used to identify the validation work still required, not a compliance claim.
