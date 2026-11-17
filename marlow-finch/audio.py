"""Marlow & Finch: audio stems (48 kHz stereo, 30.0 s).

  build/music.wav       fingerpicked acoustic guitar bed (Karplus-Strong synthesis), G - Em7 - Cmaj7 - Dsus4, 72 bpm
  build/sfx.wav         bean patter, roaster rumble + tumble, steam, cafe room tone, cup clink, logo chime
  build/vo_scratch.wav  timing guide VO from per-line WAVs (pass dir as argv[1]); replace with the real Australian VO

VO_CUES is the timing grid every other element is locked to. Keep the real VO on these cues.
"""
import os, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR, DUR = 48000, 30.0
N = int(SR * DUR)
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
rng = np.random.default_rng(11)

VO_CUES = [  # (start s, line)
    (0.8, "Good coffee takes time."),
    (2.9, "Eighteen hours of slow roasting, to be exact."),
    (7.1, "No shortcuts."),
    (9.0, "No burnt beans."),
    (13.4, "Just something worth slowing down for."),
    (21.5, "Marlow and Finch."),
    (23.9, "Slow roasted."),
    (25.5, "Fast friends."),
]

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)
def lp(x, f, order=2):
    return sosfilt(butter(order, f, "lowpass", fs=SR, output="sos"), x)
def hp(x, f, order=2):
    return sosfilt(butter(order, f, "highpass", fs=SR, output="sos"), x)

def write(path, st):
    st = np.clip(st, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st.T * 32767).astype("<i2").tobytes())

def read_mono(path):
    with wave.open(path) as w:
        sr, ch = w.getframerate(), w.getnchannels()
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768
    if ch > 1: a = a.reshape(-1, ch).mean(1)
    return a, sr

def reverb(x, secs=2.2, wet=0.22, seed=1):
    r = np.random.default_rng(seed)
    n = int(SR * secs)
    ir = r.normal(0, 1, n) * np.exp(-np.linspace(0, 7, n))
    ir = lp(ir, 5000); ir /= np.sqrt((ir ** 2).sum())
    y = fftconvolve(x, ir)[: len(x)]
    return x * (1 - wet) + y * wet * 2.0

def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(t * SR); j = min(N, i + len(sig))
    if i >= N or j <= i: return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i:j] += sig[: j - i] * gain * l * 1.414
    buf[1, i:j] += sig[: j - i] * gain * r * 1.414

# ---------------- guitar ----------------
def pluck(freq, dur=3.5, bright=0.5, decay=0.996):
    n = int(SR * dur); P = int(round(SR / freq))
    y = np.zeros(n + P + 1)
    exc = rng.uniform(-1, 1, P)
    exc = lp(exc, 1200 + 5000 * bright, 1)  # softer pick = fewer highs
    y[:P] = exc
    k = P
    while k < n + P:
        m = min(P, n + P - k)
        prev = y[k - P - 1 : k - P - 1 + m + 1] if k - P - 1 >= 0 else np.concatenate([[0], y[: m]])
        y[k : k + m] = 0.5 * (prev[1 : m + 1] + prev[:m]) * decay
        k += m
    out = y[P : P + n]
    out *= np.minimum(1, np.linspace(0, dur, n) / 0.004)  # tiny attack ramp, no click
    return out

def midi(m): return 440 * 2 ** ((m - 69) / 12)

CHORDS = {  # (bass, [inner voices low->high])  midi notes
    "G":    (43, [55, 59, 62, 67]),
    "Em7":  (40, [55, 59, 62, 67]),
    "Cmaj7":(48, [55, 59, 64, 67]),
    "Dsus4":(50, [57, 62, 67, 69]),
    "D":    (50, [57, 62, 66, 69]),
}
PROG = ["G", "Em7", "Cmaj7", "Dsus4", "G", "Em7", "Cmaj7", "D", "G"]

def music():
    bpm = 72; beat = 60 / bpm; bar = 4 * beat
    out = np.zeros((2, N))
    pattern = [0, 2, 3, 4, 3, 2, 4, 3]  # index 0 = bass, 1..4 = voices
    for b, name in enumerate(PROG):
        bass, v = CHORDS[name]
        notes = [bass] + v
        t0 = 0.35 + b * bar
        last = (b == len(PROG) - 1)
        steps = [0, 1, 2, 3] if last else range(8)
        for s in steps:
            idx = pattern[s] if not last else [0, 1, 3, 4][s]
            t = t0 + s * beat / 2 + rng.normal(0, 0.006)  # human timing
            if t >= DUR - 0.3: continue
            m = notes[idx]
            vel = (0.9 if s % 4 == 0 else 0.62) * rng.uniform(0.9, 1.05)
            sig = pluck(midi(m), dur=4.5 if last else 3.2, bright=0.35 + 0.1 * (idx > 0), decay=0.9965 if m > 52 else 0.998)
            place(out, sig, t, vel * (0.75 if idx == 0 else 0.5), pan=-0.25 + 0.12 * idx)
    for c in range(2):
        out[c] = hp(lp(out[c], 6500), 70)
        out[c] = reverb(out[c], 2.4, 0.25, seed=c + 3)
    # gentle swells: fade in, slight lift into the end card, settle at the end
    t = np.arange(N) / SR
    shape = np.clip(t / 1.5, 0, 1) * (0.85 + 0.15 * np.clip((t - 19.5) / 2, 0, 1)) * np.clip((DUR - t) / 1.2, 0, 1)
    out *= shape
    return out / (np.abs(out).max() + 1e-9) * 0.5

# ---------------- sfx ----------------
def click(dur=0.012, lo=2500, hi=7000):
    n = int(SR * dur); x = rng.normal(0, 1, n) * np.exp(-np.linspace(0, 9, n))
    return bp(x, lo, hi)

def noise(sec): return rng.normal(0, 1, int(SR * sec))

def sfx():
    out = np.zeros((2, N))
    t = np.arange(N) / SR
    # S1 0-5 s: beans tumbling onto a wooden surface, slow-mo so sparse and soft
    for _ in range(70):
        tt = rng.uniform(0.6, 4.9)
        place(out, click(rng.uniform(0.008, 0.02), 1800, 6000), tt, rng.uniform(0.05, 0.16), rng.uniform(-0.6, 0.6))
    # S2 5-12 s: roaster drum rumble + rhythmic tumble rattle + steam
    seg = slice(int(4.6 * SR), int(12.4 * SR)); n = seg.stop - seg.start
    tt = np.arange(n) / SR
    fade = np.clip(tt / 0.8, 0, 1) * np.clip((n / SR - tt) / 0.8, 0, 1)
    rumble = lp(noise(n / SR), 160, 4) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.7 * tt))
    rattle_env = 0.5 + 0.5 * np.sin(2 * np.pi * 1.3 * tt) ** 2
    rattle = np.zeros(n)
    for _ in range(260):
        k = int(rng.uniform(0, n - 1000)); c = click(rng.uniform(0.006, 0.016), 1200, 4500)
        rattle[k : k + len(c)] += c * rng.uniform(0.15, 0.4) * rattle_env[k]
    steam_env = np.clip((tt - 3.0) / 1.5, 0, 1) * np.clip((6.8 - tt) / 1.2, 0, 1)
    steam = hp(noise(n / SR), 3500, 4) * steam_env * (0.7 + 0.3 * np.sin(2 * np.pi * 0.4 * tt))
    for c in range(2):
        out[c, seg] += (rumble * 0.35 + rattle * 0.6 + steam * 0.05 * (1 if c else 0.8)) * fade
    # S3 12-20 s: warm cafe room tone + cup on saucer clink
    seg = slice(int(11.7 * SR), int(20.6 * SR)); n = seg.stop - seg.start; tt = np.arange(n) / SR
    fade = np.clip(tt / 0.8, 0, 1) * np.clip((n / SR - tt) / 1.0, 0, 1)
    for c in range(2):
        room = bp(rng.normal(0, 1, n), 200, 1800, 2) * (0.85 + 0.15 * np.sin(2 * np.pi * (0.23 + 0.05 * c) * tt))
        out[c, seg] += room * 0.035 * fade
    cl_t = np.arange(int(SR * 0.9)) / SR
    clink = sum(a * np.sin(2 * np.pi * f * cl_t) * np.exp(-cl_t * d) for f, a, d in [(2310, 1, 9), (3870, 0.6, 12), (5620, 0.35, 16), (1180, 0.25, 7)])
    clink[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    place(out, clink, 15.6, 0.09, 0.15)
    place(out, clink * 0.6, 15.68, 0.05, 0.1)  # tiny settle bounce
    # S4: soft chime under the copper shimmer
    ch_t = np.arange(int(SR * 2.5)) / SR
    chime = sum(a * np.sin(2 * np.pi * f * ch_t) * np.exp(-ch_t * 2.2) for f, a in [(1568, 1), (2349, 0.5), (3136, 0.25)])
    chime[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    place(out, chime, 22.35, 0.035, -0.2)
    for c in range(2):
        out[c] = reverb(out[c], 1.2, 0.18, seed=10 + c)
    return out

# ---------------- scratch VO ----------------
def vo(lines_dir):
    out = np.zeros(N)
    for i, (t, _) in enumerate(VO_CUES):
        a, sr = read_mono(os.path.join(lines_dir, f"l{i}.wav"))
        # resample to 48k and slow ~8% for a calmer read
        x_new = np.arange(0, len(a) / sr * 1.08, 1 / SR)
        a = np.interp(x_new / 1.08 * sr, np.arange(len(a)), a)
        j = int(t * SR); out[j : j + len(a)] += a[: N - j]
    out = hp(out, 80)
    out = out / (np.abs(out).max() + 1e-9) * 0.8
    return np.vstack([out, out])

if __name__ == "__main__":
    os.makedirs(BUILD, exist_ok=True)
    write(os.path.join(BUILD, "music.wav"), music()); print("music ok", flush=True)
    write(os.path.join(BUILD, "sfx.wav"), sfx() * 0.9); print("sfx ok", flush=True)
    if len(sys.argv) > 1:
        write(os.path.join(BUILD, "vo_scratch.wav"), vo(sys.argv[1])); print("vo ok")
