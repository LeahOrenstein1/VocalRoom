"""Generate a local listening page beside ignored audio outputs."""
import sys
from pathlib import Path
folder = Path(sys.argv[1])
files = ['01_original_vocal.wav', '02_ai_restored_vocal.wav', '03_original_vocal_plus_backing.wav', '04_ai_restored_vocal_plus_backing.wav']
for name in files:
    if not (folder/name).is_file():
        raise FileNotFoundError(name)
html = '''<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8"><title>VocalRoom · Local AI comparison</title>
<style>body{background:#111017;color:#f7f3f8;font:16px system-ui;max-width:800px;margin:70px auto;padding:20px}h1{font-size:42px;font-weight:500}p{color:#b9a2d5;line-height:1.7}button{background:#1d1826;color:#f7f3f8;padding:20px;border:1px solid #b9a2d540;border-radius:10px;cursor:pointer;text-align:left}button[aria-pressed=true]{border-color:#e9a6c2;color:#e9a6c2}.versions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:30px 0}audio{width:100%}small{color:#b9a2d5}</style>
<h1>Your voice. Before &amp; after.</h1><p>Actual local Smule Renaissance inference. Each pair is loudness matched and aligned. No cloud or paid API. Switching versions keeps your listening position.</p>
<div class="versions"><button data-file="01_original_vocal.wav" aria-pressed="true">Original vocal</button><button data-file="02_ai_restored_vocal.wav" aria-pressed="false">AI-restored vocal</button><button data-file="03_original_vocal_plus_backing.wav" aria-pressed="false">Original + backing</button><button data-file="04_ai_restored_vocal_plus_backing.wav" aria-pressed="false">AI-restored + backing</button></div>
<audio controls src="01_original_vocal.wav"></audio><p id="status" role="status">Original vocal</p><small>Listen for natural timbre, metallic artifacts, background noise, room reverb, vibrato, dynamics, breaths and consonants. A quieter or cleaner sound is not always a better performance. Keep listening volume fixed. Pair matching is attenuation-only, so the solo may be quiet.</small>
<script>const audio=document.querySelector('audio');let request=0;document.querySelectorAll('button').forEach(button=>button.onclick=()=>{const t=audio.currentTime,playing=!audio.paused,id=++request;audio.pause();audio.src=button.dataset.file;audio.onloadedmetadata=async()=>{if(id!==request)return;audio.currentTime=Math.min(t,audio.duration);if(playing)try{await audio.play()}catch{}};document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelector('#status').textContent=button.textContent;});</script></html>'''
(folder/'index.html').write_text(html,encoding='utf-8')
print(folder/'index.html')
