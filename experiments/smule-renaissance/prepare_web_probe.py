"""Write synthetic spectral fixture only; never copies user audio to web probe."""
import torch
import numpy as np
from run_experiment import ROOT, Renaissance, MANIFEST
torch.set_num_threads(4)
torch.manual_seed(42)
model = Renaissance().float().eval()
model.load_state_dict(torch.load(ROOT/'models'/MANIFEST['checkpoint_filename'], weights_only=True))
x = torch.randn(1, 2049, 48, 2) * .1
with torch.inference_mode():
    expected = model(x).numpy()
out = ROOT/'outputs'/'onnx-probe'
x.numpy().astype('<f4').tofile(out/'input.bin')
expected.astype('<f4').tofile(out/'expected.bin')
