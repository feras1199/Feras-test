#!/usr/bin/env python3
"""Add Piper voiceover to the Voltari One ad, one mp4 per language.

Steps per language:
1. Synthesise each VO line with a local Piper voice (CPU, no GPU needed).
2. Fit each line into its cue window (atempo, never faster than 1.15x).
3. Place lines on a 45 s timeline, add a light echo.
4. Duck the score under the voice (sidechain compression), mix, limit.
5. Mux with the existing picture (video stream copied, not re-encoded).
"""
import os
import subprocess
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
TOOLS = "/home/user/voltari-tools"
PIPER = os.path.join(TOOLS, "bin", "piper")
VOICES = os.path.join(TOOLS, "voices")
SCORE = os.path.join(OUT, "score_and_sfx.wav")
VIDEO = os.path.join(OUT, "voltari_one_launch_ad_45s.mp4")
DUR = 45.0
SR = 22050

VOICE = {
    "en": "en_GB-alan-medium",
    "es": "es_ES-davefx-medium",
    "ar": "ar_JO-kareem-medium",
}

# (start, end, text) matches the subtitle cues written by build_ad.py
CUES = {
    "en": [
        (0.6, 5.6, "Every morning, the city asks the same question. Stay stuck, or move."),
        (6.8, 14.0, "Meet the Voltari One. Eighty kilometres of range. Four-hour charge. Zero excuses."),
        (41.4, 43.4, "Go further than the traffic."),
    ],
    "es": [
        (0.6, 5.6, "Cada mañana, la ciudad hace la misma pregunta. ¿Quedarte atascado o avanzar?"),
        (6.8, 14.0, "Conoce la Voltari One. Ochenta kilómetros de autonomía. Carga en cuatro horas. Cero excusas."),
        (41.4, 43.4, "Llega más lejos que el tráfico."),
    ],
    "ar": [
        (0.6, 5.6, "كل صباح، تطرح المدينة السؤال نفسه: هل تبقى عالقاً، أم تتحرك؟"),
        (6.8, 14.0, "تعرّف على Voltari One. مدى يصل إلى ثمانين كيلومتراً. شحن في أربع ساعات. صفر أعذار."),
        (41.4, 43.4, "انطلق أبعد من الزحام."),
    ],
}


def synth(lang, text, path):
    model = os.path.join(VOICES, VOICE[lang] + ".onnx")
    subprocess.run(
        [PIPER, "--model", model, "--output_file", path, "--length_scale", "1.12"],
        input=text.encode("utf-8"), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def fit(src, dst, window):
    """Speed the line up only if it would overrun its window, capped at 1.15x."""
    d = duration(src)
    tempo = min(1.15, max(1.0, d / window))
    filt = f"atempo={tempo:.4f}" if tempo > 1.0001 else "anull"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-filter:a", filt, dst], check=True)
    return duration(dst), tempo


def read_wav(path):
    with wave.open(path) as w:
        frames = w.readframes(w.getnframes())
        rate = w.getframerate()
    x = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768
    return x, rate


def build(lang):
    tmp = os.path.join(OUT, f"_vo_{lang}")
    os.makedirs(tmp, exist_ok=True)
    timeline = np.zeros(int(DUR * SR), dtype=np.float32)
    report = []
    for i, (a, b, text) in enumerate(CUES[lang]):
        raw = os.path.join(tmp, f"{i}_raw.wav")
        fit_wav = os.path.join(tmp, f"{i}_fit.wav")
        synth(lang, text, raw)
        length, tempo = fit(raw, fit_wav, b - a)
        x, rate = read_wav(fit_wav)
        assert rate == SR, rate
        start = int(a * SR)
        n = min(len(x), len(timeline) - start)
        timeline[start:start + n] += x[:n]
        report.append(f"  cue {i+1}: window {b-a:.1f}s, line {length:.2f}s, tempo {tempo:.2f}")

    vo_wav = os.path.join(OUT, f"voiceover_{lang}.wav")
    pcm = (np.clip(timeline, -1, 1) * 32767).astype(np.int16)
    with wave.open(vo_wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())

    mp4 = os.path.join(OUT, f"voltari_one_launch_ad_45s_vo_{lang}.mp4")
    fc = (
        "[0:a]aresample=44100,volume=0.9[score];"
        "[1:a]aresample=44100,aecho=0.8:0.45:45|90:0.25|0.12,highpass=f=90,volume=1.35[vo];"
        "[vo]asplit=2[voside][voout];"
        "[score][voside]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[duck];"
        "[duck][voout]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]"
    )
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", SCORE, "-i", vo_wav, "-i", VIDEO,
        "-filter_complex", fc,
        "-map", "2:v", "-map", "[mix]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4,
    ], check=True)
    print(lang, "->", mp4)
    print("\n".join(report))


if __name__ == "__main__":
    for lang in ("en", "es", "ar"):
        build(lang)
