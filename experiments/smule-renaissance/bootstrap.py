"""Download only official, pinned public model artifacts. Never uploads input audio."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'model_manifest.json').read_text(encoding='utf-8-sig'))

def digest(path):
    result = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()

def download(url, target):
    partial = target.with_suffix(target.suffix + '.partial')
    with urllib.request.urlopen(url, timeout=90) as response, open(partial, 'wb') as output:
        shutil.copyfileobj(response, output)
    partial.replace(target)

def main():
    source = ROOT / 'upstream'
    if not source.exists():
        subprocess.run(['git', '-c', 'credential.helper=', 'clone', MANIFEST['source_url'], str(source)], check=True)
    subprocess.run(['git', '-C', str(source), 'checkout', '--detach', MANIFEST['source_revision']], check=True)
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != MANIFEST['source_revision']:
        raise RuntimeError('Source revision mismatch')
    models = ROOT / 'models'
    licenses = ROOT / 'licenses'
    models.mkdir(exist_ok=True)
    licenses.mkdir(exist_ok=True)
    base = f"https://huggingface.co/{MANIFEST['model_repository']}/resolve/{MANIFEST['model_revision']}"
    # The separate weight repository has its own MIT license file, not just a card tag.
    download(base + '/LICENSE', licenses / 'model-weights-LICENSE.txt')
    download(base + '/README.md', licenses / 'model-card-snapshot.md')
    shutil.copyfile(source / 'LICENSE', licenses / 'source-code-LICENSE.txt')
    target = models / MANIFEST['checkpoint_filename']
    if not target.exists() or digest(target) != MANIFEST['checkpoint_sha256']:
        download(base + '/' + MANIFEST['checkpoint_filename'], target)
    if target.stat().st_size != MANIFEST['checkpoint_bytes'] or digest(target) != MANIFEST['checkpoint_sha256']:
        raise RuntimeError('Official checkpoint size/checksum verification failed; do not load it.')
    for name in ['source-code-LICENSE.txt', 'model-weights-LICENSE.txt']:
        license_text = (licenses / name).read_text(encoding='utf-8')
        if 'MIT License' not in license_text or 'Permission is hereby granted' not in license_text:
            raise RuntimeError(f'Unexpected license in {name}; review before proceeding.')
    print(json.dumps({'source_revision': actual, 'checkpoint_bytes': target.stat().st_size,
                      'checkpoint_sha256': digest(target), 'verified': True, 'license': 'MIT code + MIT weights'}, indent=2))

if __name__ == '__main__':
    main()
