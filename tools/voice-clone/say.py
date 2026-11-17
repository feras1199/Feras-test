"""Speak any text in a cloned voice (Chatterbox, runs locally on CPU).

Usage:
  /root/venvs/clone/bin/python -I tools/voice-clone/say.py \
      --ref path/to/reference.wav --out speech.wav [--speed 1.0] [--pause 0.35] \
      "Text to speak. Several sentences are fine."

  --ref    10 to 20 s of clean speech from the person being cloned (their own voice,
           with their consent). Not stored in this repo.
  --speed  1.0 is the model's natural pace; 1.1 = 10 % faster, pitch unchanged.
  --pause  silence inserted between sentences, in seconds.

Output: mono 48 kHz WAV, levelled to about -18 dB mean. Every file carries the
Perth inaudible watermark that Chatterbox adds to mark audio as AI-generated.
"""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = []
    for p in parts:
        # Chatterbox is most reliable under ~250 characters per call.
        while len(p) > 250:
            cut = p.rfind(",", 0, 250)
            cut = cut if cut > 80 else 250
            out.append(p[: cut + 1].strip())
            p = p[cut + 1 :].strip()
        if p:
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--ref", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--pause", type=float, default=0.35)
    ap.add_argument("--exaggeration", type=float, default=0.5)
    ap.add_argument("--cfg", type=float, default=0.5)
    a = ap.parse_args()

    torch.set_num_threads(max(1, torch.get_num_threads()))
    model = ChatterboxTTS.from_pretrained(device="cpu")
    gap = torch.zeros(1, int(model.sr * a.pause))
    chunks = []
    for i, s in enumerate(sentences(a.text)):
        wav = model.generate(s, audio_prompt_path=a.ref, exaggeration=a.exaggeration, cfg_weight=a.cfg)
        chunks += ([gap] if i else []) + [wav]
        print(f"[{i + 1}] {wav.shape[-1] / model.sr:.2f}s  {s}", flush=True)

    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "raw.wav"
        torchaudio.save(str(raw), torch.cat(chunks, dim=-1), model.sr)
        filters = f"highpass=f=70,atempo={a.speed},loudnorm=I=-18:TP=-1.5:LRA=11,aresample=48000"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", filters, "-ac", "1", a.out], check=True)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
