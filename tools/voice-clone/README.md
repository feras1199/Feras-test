# Voice clone tool

Speaks any text in a cloned voice using [Chatterbox](https://github.com/resemble-ai/chatterbox)
(MIT licence), running locally on CPU. No audio is sent to any external service.

## What it needs
- A **reference recording**: 10 to 20 s of clean speech from the person being cloned.
  Only clone your own voice, or a voice you have explicit permission to use.
  The reference is deliberately **not** stored in this public repo.
- Python environment with `chatterbox-tts`, `setuptools<81` (for the watermark module)
  and FFmpeg on PATH. In the cloud session it lives at `/root/venvs/clone`.

## Setup in a fresh session
    python3 -m venv /root/venvs/clone
    /root/venvs/clone/bin/pip install chatterbox-tts "setuptools<81"
The first run downloads the model (about 3 GB) from Hugging Face.

## Use
    /root/venvs/clone/bin/python -I tools/voice-clone/say.py \
        --ref reference.wav --out speech.wav --speed 1.05 "Your text here."

About 5 to 6 s of compute per second of speech on a 4-core CPU.
Every output carries Chatterbox's inaudible Perth watermark marking it as AI-generated.
