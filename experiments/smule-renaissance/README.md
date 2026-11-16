# Smule Renaissance Small: isolated local experiment

This directory does not change VocalRoom's production DSP or import the model into the app. No training, paid API, remote inference, telemetry, or audio upload is used. Personal inputs, outputs, checkpoints, environments and ONNX files are ignored by Git.

## Reproduce on Windows (Python 3.12)

From the repository root, in PowerShell:

```powershell
py -3.12 -m venv experiments/smule-renaissance/.venv
$python = 'experiments/smule-renaissance/.venv/Scripts/python.exe'
& $python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r experiments/smule-renaissance/requirements-lock.txt
& $python experiments/smule-renaissance/bootstrap.py
& $python experiments/smule-renaissance/test_experiment.py
& $python experiments/smule-renaissance/run_experiment.py --vocal PATH_TO_DRY_VOCAL.wav --backing PATH_TO_SEPARATE_BACKING.wav --start-seconds 25 --seconds 20 --runs 2 --apply-reliable-alignment --out experiments/smule-renaissance/outputs/listening
```

The lock includes optional native ONNX analysis tools. `requirements-cpu.txt` is the smaller inference-only environment. Dependencies and public artifacts are downloaded once; inference is local and works offline afterward. `--synthetic-smoke-test --seconds 3` is a plumbing check only, never a singing quality evaluation. Optional `export-project.html` reads saved projects locally without changing them and downloads separate dry, timeline-aligned vocal/backing stems. It is a development utility, excluded from the production build.

Only use authorized vocal recordings. Never provide a complete vocal-plus-backing mix as `--vocal`. Restore the vocal first; add backing afterward. The exported stems retain edits, faders and pans, without DSP. Existing microphone bleed is still present if it was captured in the vocal source.

## Implementation and provenance

`model_manifest.json` pins both official repository revisions, the checkpoint's 42,064,415-byte size and SHA-256. `bootstrap.py` verifies these before inference and saves the source-code MIT license and the **separate model-weight MIT license** under `licenses/`. A card license label alone is not treated as proof. Both permit commercial use and redistribution while retaining their notices. Dependency licenses still apply separately.

Official sources:

- https://github.com/smulelabs/smule-renaissance/tree/b80e3a69c347f1290e62dddcb8e069654825aa7b
- https://huggingface.co/smulelabs/Smule-Renaissance-Small/tree/12024e3250ace99e566662a2963e6158d104e69c

We use the official `Renaissance` network and strict pretrained state loading (`weights_only=True`, CPU, eval/inference mode). Preprocessing follows official inference: mono, 48 kHz, 60 Hz high-pass, peak normalization, 4096-point STFT with 2048 hop, spectral restoration, iSTFT, original peak scale. Upstream inverse STFT omits an explicit length. We reflect-pad to a hop boundary and crop afterward so duration is preserved even for non-hop-aligned recordings. No source/model file is patched.

`--apply-reliable-alignment` estimates a bounded ±200 ms global lag by correlation, refines to source samples, and only applies it above a .65 confidence threshold. This is a diagnostic, not proof of alignment for every generative output; inspect transients. Applied shifts are reported and zero-filled, never time-stretched. Raw unaligned outputs remain available.

## Listening outputs and limitations

Each run writes raw sources/model output, `report.json`, and these float WAV pairs:

1. `01_original_vocal.wav`
2. `02_ai_restored_vocal.wav`
3. `03_original_vocal_plus_backing.wav`
4. `04_ai_restored_vocal_plus_backing.wav`

Each pair is attenuation-only matched using integrated LUFS, with common 4× reconstructed-peak headroom. Mix files use the same separate backing after inference, then pairwise loudness matching. This is an experiment mix, not the production master. Playback may be quiet because normalization does not amplify the original. Set a comfortable listening volume once and keep it fixed.

`make_comparison.py OUTPUT_DIRECTORY` writes a local listening page with four versions and position-preserving A/B playback. The numeric report records source checksum, versions, input/output frame counts, lag, gains, inference times and sampled process RSS. RSS is process memory, not just model weights; concurrent app load affects timings. No objective score here establishes naturalness or perceptual noise removal without a clean reference.

Score each of natural timbre, metallic/robotic artifacts, room reverb, background noise, vibrato, dynamics, breaths and consonants in both solo and mix. Note exact timestamps, improvement and damage; include a blind A/B where possible. If restoration makes the vocal less natural, keep the original. See `REPORT.md` for measured results and the explicit listening gap.

## Browser probes (only after pretrained inference)

```powershell
& $python experiments/smule-renaissance/probe_onnx.py
& $python experiments/smule-renaissance/prepare_web_probe.py
npm ci --prefix experiments/smule-renaissance/web
npm run dev
```

Open `http://127.0.0.1:5173/experiments/smule-renaissance/browser-probe.html`, run WASM and WebGPU separately, and save the displayed results. The web dependency is isolated under `web/`, not in the production app. The fixture is synthetic spectral data; this is **not** a full browser audio restoration test. ONNX outputs are ignored. No browser speed or quality claim should be inferred from native PyTorch results.

See `REPORT.md` for actual compatibility findings, blockers and a staged browser integration plan. Do not integrate the model until subjective quality and numerical parity are accepted.
