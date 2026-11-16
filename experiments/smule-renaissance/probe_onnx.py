"""Isolated spectral-network export probe. Not a production audio/browser pipeline."""
import json
import time
from pathlib import Path
import numpy as np
import torch
import onnx
import onnxruntime as ort
from run_experiment import ROOT, Renaissance, MANIFEST

torch.set_num_threads(4)
out = ROOT / 'outputs' / 'onnx-probe'
out.mkdir(parents=True, exist_ok=True)
report = {'scope': 'spectral network only; STFT/iSTFT stay outside graph', 'opset': 17,
          'browser_wasm': 'NOT_TESTED', 'browser_webgpu': 'NOT_TESTED'}
try:
    model = Renaissance().float().eval()
    model.load_state_dict(torch.load(ROOT / 'models' / MANIFEST['checkpoint_filename'], weights_only=True))
    torch.manual_seed(42)
    x = torch.randn(1, 2049, 48, 2) * .1
    started = time.perf_counter()
    with torch.inference_mode():
        torch.onnx.export(model, x, out / 'renaissance.onnx', opset_version=17,
                          input_names=['spectrum'], output_names=['restored'],
                          dynamic_axes={'spectrum': {2: 'frames'}, 'restored': {2: 'frames'}},
                          dynamo=False)
    graph = onnx.load(out / 'renaissance.onnx')
    onnx.checker.check_model(graph)
    report.update(export_seconds=time.perf_counter()-started, bytes=(out/'renaissance.onnx').stat().st_size,
                  operators=sorted(set(node.op_type for node in graph.graph.node)))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(out/'renaissance.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    comparisons = []
    for frames in [48, 73]:
        sample = torch.randn(1, 2049, frames, 2) * .1
        with torch.inference_mode():
            expected = model(sample).numpy()
        started = time.perf_counter()
        actual = session.run(None, {'spectrum': sample.numpy()})[0]
        error = actual - expected
        comparisons.append({'frames': frames, 'seconds': time.perf_counter()-started,
                            'max_abs_error': float(np.max(np.abs(error))),
                            'rms_error': float(np.sqrt(np.mean(error**2))),
                            'relative_rms': float(np.linalg.norm(error)/np.linalg.norm(expected)),
                            'finite': bool(np.isfinite(actual).all())})
    report.update(status='export_and_native_cpu_inference_completed', comparisons=comparisons)
except Exception as error:
    report.update(status='blocked', error_type=type(error).__name__, error=str(error))
finally:
    (out/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
