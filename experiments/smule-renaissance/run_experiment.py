"""Local-only pretrained inference and honest listening comparisons; no training."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import threading
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'upstream'))

import numpy as np
import psutil
import soundfile as sf
from scipy import signal
import torch
import torchaudio
from model import Renaissance
from spectral_ops import STFT, iSTFT
from bootstrap import digest, MANIFEST

RATE = 48000
HOP = 2048


def load_audio(path, start=0.0, seconds=30.0, mono=False):
    with sf.SoundFile(path) as source:
        source.seek(min(len(source), round(start * source.samplerate)))
        data = source.read(frames=round(seconds * source.samplerate), dtype='float32', always_2d=True)
        rate = source.samplerate
    if not len(data):
        raise ValueError('The selected audio range is empty.')
    if not np.isfinite(data).all():
        raise ValueError('Input contains non-finite PCM values.')
    if mono:
        data = data.mean(axis=1, keepdims=True)
    if rate != RATE:
        divisor = math.gcd(rate, RATE)
        data = signal.resample_poly(data, RATE // divisor, rate // divisor, axis=0).astype(np.float32)
    return data, rate


def synthetic_input(seconds=3.0):
    # A generated harmonic signal, NOT a human singing-quality reference.
    time_axis = np.arange(round(RATE * seconds), dtype=np.float64) / RATE
    frequency = 190 * 2 ** (.18 * np.sin(2 * np.pi * .3 * time_axis) + .012 * np.sin(2 * np.pi * 5.5 * time_axis))
    phase = np.cumsum(2 * np.pi * frequency / RATE)
    envelope = np.minimum(1, np.maximum(0, (time_axis - .25) * 12)) * np.minimum(1, np.maximum(0, (seconds - .15 - time_axis) * 10))
    harmonic = sum(np.sin((i + 1) * phase) / (i + 1) ** 1.3 for i in range(8)) * .12 * envelope
    noise = np.random.default_rng(42).normal(0, .003, len(time_axis))
    vocal = (harmonic + noise).astype(np.float32)[:, None]
    backing = (.04 * np.sin(2 * np.pi * 110 * time_axis))[:, None]
    return vocal, np.repeat(backing, 2, axis=1)


def prepare(waveform):
    tensor = torch.from_numpy(waveform[:, 0].copy()).unsqueeze(0)
    # Exactly the official preprocessing: mono / 48 kHz / 60 Hz high-pass.
    return torchaudio.functional.highpass_biquad(tensor, RATE, cutoff_freq=60.0)


def infer(model, stft, istft, waveform):
    original_length = waveform.shape[-1]
    padding = (-original_length) % HOP
    if padding:
        waveform = torch.nn.functional.pad(waveform, (0, padding), mode='reflect')
    normalization = waveform.abs().max()
    normalized = waveform / normalization if normalization > 0 else waveform
    with torch.inference_mode():
        enhanced = istft(model(stft(normalized)))
    enhanced = enhanced * normalization if normalization > 0 else enhanced
    enhanced = enhanced[..., :original_length]
    if enhanced.shape[-1] != original_length or not torch.isfinite(enhanced).all():
        raise RuntimeError('Invalid model output length or non-finite samples.')
    return enhanced.squeeze(0).cpu().float().numpy()[:, None]


def alignment_estimate(original, restored, max_ms=200):
    # A measured diagnostic; never silently shifts a low-confidence generative result.
    ratio = RATE // 8000
    a = signal.resample_poly(original[:RATE * 30, 0], 1, ratio)
    b = signal.resample_poly(restored[:RATE * 30, 0], 1, ratio)
    a, b = a - a.mean(), b - b.mean()
    correlation = signal.correlate(b, a, mode='full', method='fft')
    lags = signal.correlation_lags(len(b), len(a), mode='full')
    selected = np.abs(lags) <= round(max_ms * 8)
    window, positions = correlation[selected], lags[selected]
    scale = np.linalg.norm(a) * np.linalg.norm(b)
    if scale < 1e-12:
        return {'estimated_restored_delay_samples': 0, 'correlation': 0.0, 'reliable': False}
    index = int(np.argmax(np.abs(window)))
    coarse = int(positions[index] * ratio)
    # Refine at the original sample rate rather than shifting on an 8 kHz grid.
    aa, bb = original[:RATE * 30, 0], restored[:RATE * 30, 0]
    aa, bb = aa - aa.mean(), bb - bb.mean()
    scores = {}
    for lag in range(coarse - ratio, coarse + ratio + 1):
        left = aa[:len(aa)-lag] if lag > 0 else aa[-lag:] if lag < 0 else aa
        right = bb[lag:] if lag > 0 else bb[:len(bb)+lag] if lag < 0 else bb
        scores[lag] = float(abs(np.dot(left, right)))
    refined = max(scores, key=scores.get)
    return {'estimated_restored_delay_samples': refined,
            'correlation': float(abs(window[index]) / scale), 'reliable': bool(abs(window[index]) / scale >= .65)}


def shift_without_resampling(audio, delay_samples):
    output = np.zeros_like(audio)
    if delay_samples > 0 and delay_samples < len(audio):
        output[:-delay_samples] = audio[delay_samples:]
    elif delay_samples < 0 and -delay_samples < len(audio):
        output[-delay_samples:] = audio[:delay_samples]
    elif delay_samples == 0:
        output[:] = audio
    return output


def loudness(audio):
    import pyloudnorm as pyln
    if not np.any(np.abs(audio) > 1e-10):
        return None
    measured = audio
    if len(measured) < int(RATE * .4):
        measured = np.pad(measured, ((0, int(RATE * .4) - len(measured)), (0, 0)))
    value = float(pyln.Meter(RATE).integrated_loudness(measured))
    return value if math.isfinite(value) else None


def reconstructed_peak(audio):
    # Measured 4x polyphase peak estimate for listening-file headroom; no certification claim.
    peak = 0.0
    for start in range(0, len(audio), RATE * 5):
        segment = audio[max(0, start - 256):min(len(audio), start + RATE * 5 + 256)]
        peak = max(peak, float(np.max(np.abs(signal.resample_poly(segment, 4, 1, axis=0)))))
    return peak


def matched_pair(a, b):
    levels = [loudness(a), loudness(b)]
    target = min([x for x in levels if x is not None] + [-18.0])
    gains = [10 ** ((target - level) / 20) if level is not None else 1 for level in levels]
    versions = [a * gains[0], b * gains[1]]
    peak = max(reconstructed_peak(version) for version in versions)
    common = min(1.0, 10 ** (-1 / 20) / max(peak, 1e-12))
    return [version * common for version in versions], {'input_lufs': levels, 'gains': gains,
            'common_headroom_gain': common, 'output_lufs': [loudness(v * common) for v in versions]}


def add_backing(vocal, backing, vocal_offset_ms, backing_gain_db):
    count = max(len(backing), len(vocal) + max(0, round(vocal_offset_ms * RATE / 1000)))
    result = np.zeros((count, max(2, backing.shape[1])), dtype=np.float32)
    result[:len(backing), :backing.shape[1]] = backing * 10 ** (backing_gain_db / 20)
    if backing.shape[1] == 1:
        result[:len(backing), 1] = result[:len(backing), 0]
    offset = round(vocal_offset_ms * RATE / 1000)
    if offset >= 0:
        result[offset:offset + len(vocal)] += vocal
    elif -offset < len(vocal):
        result[:len(vocal) + offset] += vocal[-offset:]
    return result


class MemoryMonitor:
    def __enter__(self):
        self.process = psutil.Process()
        self.baseline = self.process.memory_info().rss
        self.peak = self.baseline
        self.done = threading.Event()
        def monitor():
            while not self.done.wait(.01):
                self.peak = max(self.peak, self.process.memory_info().rss)
        self.thread = threading.Thread(target=monitor, daemon=True)
        self.thread.start()
        return self
    def __exit__(self, *args):
        self.done.set()
        self.thread.join()
        self.peak = max(self.peak, self.process.memory_info().rss)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--vocal', type=Path, help='Authorized dry isolated vocal; never a full mix.')
    source.add_argument('--synthetic-smoke-test', action='store_true', help='Tests actual inference, not singing quality.')
    parser.add_argument('--backing', type=Path)
    parser.add_argument('--start-seconds', type=float, default=0)
    parser.add_argument('--seconds', type=float, default=20)
    parser.add_argument('--out', type=Path, default=ROOT / 'outputs' / 'latest')
    parser.add_argument('--threads', type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument('--runs', type=int, default=2)
    parser.add_argument('--restored-delay-ms', type=float, default=0, help='Explicit measured output delay correction, not time stretching.')
    parser.add_argument('--apply-reliable-alignment', action='store_true')
    parser.add_argument('--vocal-offset-ms', type=float, default=0, help='Placement of the isolated vocal relative to the separate backing.')
    parser.add_argument('--backing-gain-db', type=float, default=-6)
    args = parser.parse_args()
    if args.threads < 1 or args.runs < 1 or args.seconds < .1 or args.start_seconds < 0:
        parser.error('Use positive thread/run/duration values and a non-negative start.')
    args.out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(args.threads)
    torch.manual_seed(42)
    checkpoint = ROOT / 'models' / MANIFEST['checkpoint_filename']
    if not checkpoint.exists() or digest(checkpoint) != MANIFEST['checkpoint_sha256']:
        raise RuntimeError('Run bootstrap.py first: the verified checkpoint is missing or changed.')
    if args.synthetic_smoke_test:
        original, backing = synthetic_input(min(args.seconds, 3))
        kind = 'synthetic_smoke_only_not_human_singing'
        input_metadata = {'kind': kind, 'generated_seed': 42}
    else:
        original, source_rate = load_audio(args.vocal, args.start_seconds, args.seconds, mono=True)
        backing = load_audio(args.backing, args.start_seconds, args.seconds)[0] if args.backing else None
        kind = 'authorized_dry_vocal_selected_by_user'
        input_metadata = {'kind': kind, 'basename': args.vocal.name, 'sha256': digest(args.vocal), 'source_sample_rate': source_rate}
    prepared = prepare(original)
    load_start = time.perf_counter()
    model = Renaissance().float().eval()
    state = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model.load_state_dict(state, strict=True)
    del state
    load_seconds = time.perf_counter() - load_start
    stft = STFT(4096, HOP, 4096)
    istft = iSTFT(4096, HOP, 4096)
    durations = []
    print(f'Running actual pretrained inference on {kind}: {len(original) / RATE:.3f} seconds', flush=True)
    with MemoryMonitor() as memory:
        for run in range(args.runs):
            started = time.perf_counter()
            restored = infer(model, stft, istft, prepared)
            durations.append(time.perf_counter() - started)
            print(f'Run {run + 1}: {durations[-1]:.3f} seconds', flush=True)
    alignment = alignment_estimate(original, restored)
    delay = round(args.restored_delay_ms * RATE / 1000)
    if args.apply_reliable_alignment and alignment['reliable']:
        delay += alignment['estimated_restored_delay_samples']
    aligned = shift_without_resampling(restored, delay)
    sf.write(args.out / 'raw_original_vocal.wav', original, RATE, subtype='FLOAT')
    sf.write(args.out / 'raw_model_input_highpass.wav', prepared.squeeze(0).numpy(), RATE, subtype='FLOAT')
    sf.write(args.out / 'raw_ai_restored_vocal.wav', restored, RATE, subtype='FLOAT')
    (dry_match, wet_match), pair = matched_pair(original, aligned)
    sf.write(args.out / '01_original_vocal.wav', dry_match, RATE, subtype='FLOAT')
    sf.write(args.out / '02_ai_restored_vocal.wav', wet_match, RATE, subtype='FLOAT')
    mixes = None
    if backing is not None:
        first = add_backing(dry_match, backing, args.vocal_offset_ms, args.backing_gain_db)
        second = add_backing(wet_match, backing, args.vocal_offset_ms, args.backing_gain_db)
        (first, second), mixes = matched_pair(first, second)
        sf.write(args.out / '03_original_vocal_plus_backing.wav', first, RATE, subtype='FLOAT')
        sf.write(args.out / '04_ai_restored_vocal_plus_backing.wav', second, RATE, subtype='FLOAT')
    seconds = len(original) / RATE
    report = {'status': 'actual_pretrained_inference_completed', 'model': MANIFEST,
              'input': input_metadata, 'sample_rate': RATE, 'frames': len(original),
              'output_frames': len(restored), 'preprocessing': 'official mono / 48 kHz / 60 Hz high-pass / peak normalization and restoration',
              'padding': 'right reflect pad to 2048-sample hop, then crop to exact input length',
              'device': 'cpu', 'torch': torch.__version__, 'torchaudio': torchaudio.__version__,
              'python': platform.python_version(), 'cpu': platform.processor(), 'threads': args.threads,
              'parameters': sum(p.numel() for p in model.parameters()), 'model_load_seconds': load_seconds,
              'inference_seconds': durations, 'median_inference_seconds': statistics.median(durations),
              'real_time_factor': statistics.median(durations) / seconds,
              'rss_baseline_bytes': memory.baseline, 'rss_peak_bytes': memory.peak,
              'rss_increment_bytes': memory.peak - memory.baseline,
              'alignment': {**alignment, 'applied_delay_samples': delay, 'timeline_length_preserved': True,
                            'note': 'Zero delay by default. Correlation is diagnostic; inspect real singing before trusting automatic alignment.'},
              'vocal_loudness_matching': pair, 'mix_loudness_matching': mixes,
              'quality_evaluation': {criterion: 'LISTENING_PENDING: actual authorized singing rendered; human comparison still required' if not args.synthetic_smoke_test else 'NOT_EVALUATED: synthetic smoke test only' for criterion in
                ['natural_timbre', 'metallic_artifacts', 'room_reverb', 'background_noise', 'vibrato', 'dynamics', 'breaths_consonants']},
              'recommendation': 'Do not integrate yet. Pretrained inference works; require a listening assessment of timbre, artifacts and musical detail before production integration.'}
    (args.out / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'output_directory': str(args.out), 'real_time_factor': report['real_time_factor'],
                      'rss_peak_bytes': memory.peak, 'quality_evaluated': False}, indent=2))

if __name__ == '__main__':
    main()
