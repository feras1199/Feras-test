#!/usr/bin/env python3
"""Voltari One launch ad: motion-graphics build.

Frames are drawn with PIL (1920x1080, 24 fps, 45 s), the score and SFX are
synthesised with numpy, and ffmpeg muxes the result. There is no live footage
and no voiceover here: those need a generative video / TTS service that this
build does not have. Subtitle files for the voiceover lines are written too.
"""
import glob
import math
import os
import random
import subprocess
import wave
from functools import lru_cache
from multiprocessing import get_context

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, DUR = 1920, 1080, 24, 45
N = FPS * DUR
SS = 2  # supersampling for vector drawing

GRAPH = (27, 29, 32)
GRAPH_MID = (52, 56, 62)
GRAPH_EDGE = (100, 105, 112)
LIME = (198, 244, 50)
WHITE = (244, 245, 242)
RED = (255, 60, 40)
AMBER = (255, 168, 80)
MUTED = (200, 205, 200)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MP4_NAME = "voltari_one_launch_ad_45s.mp4"


# ----------------------------------------------------------------- fonts
def _find(*patterns):
    for pat in patterns:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    raise SystemExit(f"no font matched: {patterns}")


FONT_HEAD = _find("/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf")  # stand-in for Montserrat ExtraBold
FONT_MED = _find("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/opentype/inter/Inter-Bold.otf")
FONT_MONO = _find(
    "/usr/share/fonts/truetype/jetbrains-mono/*Light*.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/*Regular*.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
)


@lru_cache(None)
def font(path, size):
    return ImageFont.truetype(path, size)


def cap_height(f):
    return -f.getbbox("H", anchor="ls")[1]


# ----------------------------------------------------------------- helpers
def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def prog(t, a, b):
    return clamp((t - a) / (b - a))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def lerp(a, b, k):
    return a + (b - a) * k


yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
_r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / math.sqrt(2)
VIGNETTE = (1.0 - 0.45 * np.clip(_r, 0, 1) ** 2)[..., None].astype(np.float32)
CENTER_DIM = Image.fromarray(
    np.dstack([np.zeros((H, W, 3), np.uint8), (np.clip(1 - _r * 1.4, 0, 1) * 150).astype(np.uint8)]), "RGBA"
)


class View:
    """Maps bike-local coords (origin at bike centre) to supersampled canvas px."""

    def __init__(self, cx, cy, z, sx, sy):
        self.cx, self.cy, self.z, self.sx, self.sy = cx, cy, z, sx, sy

    def P(self, x, y):
        return ((self.sx + (x - self.cx) * self.z) * SS, (self.sy + (y - self.cy) * self.z) * SS)

    def L(self, v):
        return v * self.z * SS


# Speed ramp: slow -> fast -> slow, integrated so the wheel angle is continuous.
_u = np.linspace(0, 1, 2001)
_vel = 0.2 + 1.8 * np.sin(np.pi * _u) ** 2
_F = np.concatenate([[0.0], np.cumsum((_vel[1:] + _vel[:-1]) / 2 * np.diff(_u))])
_F /= _F[-1]


def ramp(u):
    return float(np.interp(clamp(u), _u, _F))


# ----------------------------------------------------------------- drawing
def glow_1x(base, cx, cy, r, color, strength, n=12):
    g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    for k in range(n, 0, -1):
        rr = r * (1 + 3.0 * k / n)
        a = strength * (1 - k / (n + 1)) ** 2 * 0.55
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=tuple(color) + (int(255 * clamp(a)),))
    return Image.alpha_composite(base, g)


def draw_wheel(d, cx, cy, r, angle, tyre_col=WHITE, tyre_w=7.0, spokes=16, spoke_col=(178, 183, 189)):
    """All arguments in supersampled px."""
    tw = max(1, int(tyre_w))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=tuple(tyre_col) + (255,), width=tw)
    ri = r - tw - 4 * SS
    if ri > 4:
        d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], outline=(80, 84, 90, 255), width=max(1, 2 * SS))
        for k in range(spokes):
            a = angle + k * 2 * math.pi / spokes
            ex, ey = cx + ri * math.cos(a), cy + ri * math.sin(a)
            d.line([(cx, cy), (ex, ey)], fill=tuple(spoke_col) + (255,), width=max(1, int(1.6 * SS)))
    hr = max(2.0, r * 0.07)
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(100, 105, 112, 255))


def draw_tube_text(layer, v, a, b, text, size_local=26):
    fnt = font(FONT_HEAD, max(8, int(v.L(size_local))))
    th = int(v.L(size_local) * 1.7)
    tw = int(fnt.getlength(text)) + 30
    tmp = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((15, th / 2), text, font=fnt, fill=WHITE + (235,), anchor="lm")
    ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    rot = tmp.rotate(-ang, expand=True, resample=Image.BICUBIC)
    mx, my = v.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    layer.alpha_composite(rot, dest=(int(mx - rot.width / 2), int(my - rot.height / 2)))


def draw_bike(layer, v, wheel_angle, light=0.0):
    d = ImageDraw.Draw(layer)
    P, L = v.P, v.L

    for hx in (-170, 170):
        cx, cy = P(hx, 70)
        draw_wheel(d, cx, cy, L(120), wheel_angle, tyre_w=L(7))

    def tube(a, b, w, col):
        d.line([P(*a), P(*b)], fill=tuple(col) + (255,), width=max(1, int(L(w))))

    tube((-95, -55), (-170, 70), 12, GRAPH_MID)   # seatstay
    tube((-10, 70), (-170, 70), 12, GRAPH_MID)    # chainstay
    tube((-10, 70), (-95, -55), 14, GRAPH_MID)    # seat tube
    tube((120, -70), (-10, 70), 18, GRAPH_MID)    # down tube
    tube((120, -70), (170, 70), 11, GRAPH_MID)    # fork
    tube((120, -70), (132, -118), 12, GRAPH_MID)  # stem
    tube((132, -118), (100, -124), 10, GRAPH_MID) # bar
    tube((-95, -55), (-105, -100), 8, GRAPH_MID)  # seatpost
    tube((-132, -100), (-70, -100), 14, (18, 20, 23))  # saddle
    draw_tube_text(layer, v, (-10, 70), (120, -70), "VOLTARI")
    tube((-95, -55), (120, -70), 13, LIME)        # lime accent on top tube

    lx, ly = P(146, -100)
    lr = L(20)
    lamp = tuple(int(lerp(a, b, clamp(light))) for a, b in zip((72, 76, 82), (255, 255, 250)))
    d.ellipse([lx - lr, ly - lr, lx + lr, ly + lr], fill=lamp + (255,), outline=(150, 155, 160, 255), width=max(1, int(L(2))))


def bike_on(base, v, wheel_angle, light=0.0):
    if light > 0:
        lx, ly = v.P(146, -100)
        base = glow_1x(base, lx / SS, ly / SS, v.z * 34, LIME, light)
    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    draw_bike(layer, v, wheel_angle, light)
    return Image.alpha_composite(base, layer.resize((W, H), Image.LANCZOS))


def text_layer(items):
    """items: (xy, text, font, colour, anchor, alpha 0..1)."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for (x, y), s, f, col, anc, a in items:
        if a <= 0.001:
            continue
        d.text((x, y), s, font=f, fill=tuple(col) + (int(255 * clamp(a)),), anchor=anc)
    return layer


def solid_base(color=GRAPH):
    return Image.new("RGBA", (W, H), tuple(color) + (255,))


def make_grid():
    img = solid_base()
    d = ImageDraw.Draw(img)
    for x in range(0, W, 120):
        d.line([(x, 0), (x, H)], fill=(36, 39, 43, 255), width=1)
    for y in range(0, H, 120):
        d.line([(0, y), (W, y)], fill=(36, 39, 43, 255), width=1)
    return img


# ----------------------------------------------------------------- precomputed backgrounds
def make_traffic():
    rng = random.Random(7)
    img = Image.new("RGB", (2400, 1350), (34, 36, 40))
    d = ImageDraw.Draw(img)
    glow = Image.new("RGBA", (2400, 1350), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for lane in range(7):
        y = 90 + lane * 170
        d.line([(0, y - 30), (2400, y - 30)], fill=(52, 55, 60), width=3)
        x = rng.randint(-150, 60)
        while x < 2450:
            col = rng.choice([(58, 62, 68), (228, 229, 226), (30, 31, 35), (96, 100, 108), (150, 120, 90)])
            d.rounded_rectangle([x, y, x + 150, y + 80], radius=16, fill=col)
            for yy_ in (y + 14, y + 66):  # cars face right, so rear lights are on the left edge
                d.ellipse([x + 4, yy_ - 7, x + 18, yy_ + 7], fill=RED)
                gd.ellipse([x - 16, yy_ - 26, x + 38, yy_ + 26], fill=RED + (110,))
            x += 150 + rng.randint(30, 140)
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    arr = np.asarray(img, dtype=np.float32)
    gx, gy = np.meshgrid(np.arange(2400) / 2400, np.arange(1350) / 1350)
    a = np.clip(1 - gx * 0.9 - gy * 0.3, 0, 1)[..., None] * 0.32  # golden-hour haze, upper left
    arr = arr * (1 - a) + np.array(AMBER, np.float32) * a
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def make_bokeh():
    rng = random.Random(3)
    img = Image.new("RGBA", (2200, 1238), (22, 24, 27, 255))
    layer = Image.new("RGBA", (2200, 1238), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(70):
        x, y = rng.uniform(0, 2200), rng.uniform(0, 1238)
        r = rng.uniform(18, 70)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rng.choice([LIME, WHITE, AMBER]) + (rng.randint(40, 120),))
    layer = layer.filter(ImageFilter.GaussianBlur(9))
    return Image.alpha_composite(img, layer).convert("RGB")


def make_streak():
    rng = random.Random(11)
    img = Image.new("RGBA", (4800, 1080), (30, 32, 36, 255))
    d = ImageDraw.Draw(img)
    for lane in range(6):
        y = 60 + lane * 170
        d.line([(0, y + 120), (4800, y + 120)], fill=(70, 74, 80, 255), width=4)
        for x0 in range(0, 4800, 2400):  # one period, repeated
            pass
        x = rng.randint(0, 200)
        while x < 4800:
            col = rng.choice([(58, 62, 68), (222, 223, 220), (40, 42, 46), (112, 116, 124)])
            d.rounded_rectangle([x, y, x + 260, y + 110], radius=18, fill=col)
            x += 260 + rng.randint(60, 260)
    return img.filter(ImageFilter.GaussianBlur(7)).convert("RGBA")


BIG_TRAFFIC = make_traffic()
BOKEH = make_bokeh()
STREAK = make_streak()
BASE_GRID = make_grid()


# ----------------------------------------------------------------- scenes
def scene1(t):
    """0-6 s: overhead gridlock, slow push-in, 'Stuck?' typed out."""
    p = prog(t, 0, 6)
    cw = lerp(2400, 1920, smooth(p))
    ch = cw * 9 / 16
    box = (1200 - cw / 2, 675 - ch / 2, 1200 + cw / 2, 675 + ch / 2)
    base = BIG_TRAFFIC.crop(tuple(int(round(v)) for v in box)).resize((W, H), Image.BILINEAR).convert("RGBA")
    base = Image.alpha_composite(base, CENTER_DIM)
    f = font(FONT_HEAD, 230)
    word = "Stuck?"
    x0 = 960 - f.getlength(word) / 2
    base_y = 540 + cap_height(f) / 2
    n = 0 if t < 1.2 else min(len(word), int((t - 1.2) / 0.2) + 1)
    items = []
    for i in range(n):
        items.append(((x0 + f.getlength(word[:i]), base_y), word[i], f, LIME if word[i] == "?" else WHITE, "ls", 1))
    return Image.alpha_composite(base, text_layer(items))


def scene2(t):
    """6-12 s: shallow depth of field, slow dolly-in on the bike."""
    p = prog(t, 6, 12)
    cw = lerp(2200, 1920, smooth(p))
    ch = cw * 9 / 16
    box = (1100 - cw / 2, 619 - ch / 2, 1100 + cw / 2, 619 + ch / 2)
    base = BOKEH.crop(tuple(int(round(v)) for v in box)).resize((W, H), Image.BILINEAR).convert("RGBA")
    v = View(0, 0, lerp(1.0, 1.1, smooth(p)), 700, 600)
    return bike_on(base, v, (t - 6) * 3.0)


def scene3(t):
    """12-20 s: tracking shot past stopped traffic, background motion blur, bike sharp."""
    tt = t - 12
    off = int(tt * 1600) % 2400
    base = STREAK.crop((off, 0, off + W, H)).convert("RGBA")
    p = prog(t, 12, 20)
    v = View(0, 0, lerp(1.1, 1.22, smooth(p)), 700, lerp(640, 600, smooth(p)))
    return bike_on(base, v, tt * 5.2)


def scene4(t):
    """20-28 s: macro shots with a slow-fast-slow speed ramp; light clicks on at 26.2 s."""
    angle = 2 * math.pi * 5 * ramp((t - 20) / 8)
    if t < 22.6:
        p = prog(t, 20, 22.6)
        cx, cy, z = 12.5, -62.5, lerp(3.0, 3.4, smooth(p))  # lime accent line
    elif t < 25.2:
        p = prog(t, 22.6, 25.2)
        cx, cy, z = 170, 70, lerp(2.6, 2.9, smooth(p))      # spinning front wheel
    else:
        p = prog(t, 25.2, 28)
        cx, cy, z = 146, -100, lerp(3.6, 4.0, smooth(p))    # front light
    light = smooth(prog(t, 26.2, 26.45))
    return bike_on(BASE_GRID.copy(), View(cx, cy, z, 960, 540), angle, light)


def scene5(t):
    """28-36 s: data overlays. Numbers exactly as briefed."""
    v = View(0, 0, 0.95, 520, 600)
    base = bike_on(BASE_GRID.copy(), v, t * 5.2, light=1.0)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f_big, f_unit, f_lab = font(FONT_HEAD, 300), font(FONT_HEAD, 110), font(FONT_MONO, 44)

    a80 = smooth(prog(t, 28.4, 28.9))
    items = [
        ((1000, 430), "80", f_big, LIME, "ls", a80),
        ((1000 + f_big.getlength("80") + 20, 430), "km", f_unit, WHITE, "ls", a80),
        ((1004, 500), "range", f_lab, MUTED, "ls", a80),
    ]
    a4 = smooth(prog(t, 32.6, 33.1))
    items += [
        ((1000, 800), "4", f_big, LIME, "ls", a4),
        ((1000 + f_big.getlength("4") + 20, 800), "hr", f_unit, WHITE, "ls", a4),
        ((1004, 870), "charge", f_lab, MUTED, "ls", a4),
    ]
    layer = text_layer(items)
    d = ImageDraw.Draw(layer)

    ab = smooth(prog(t, 29.0, 29.5))
    if ab > 0:
        d.rounded_rectangle([1000, 560, 1480, 650], radius=14, outline=WHITE + (int(255 * ab),), width=5)
        d.rounded_rectangle([1488, 585, 1508, 625], radius=4, fill=WHITE + (int(255 * ab),))
        fill_k = smooth(prog(t, 29.5, 32.0))
        if fill_k > 0:
            right = 1012 + 456 * fill_k
            d.rounded_rectangle([1012, 572, max(1024, right), 638], radius=8, fill=LIME + (int(255 * ab),))
    return Image.alpha_composite(base, layer)


def scene6(t):
    """36-41 s: cafe beat. On-screen dialogue card (Maya's lip-sync is not possible here)."""
    base = BASE_GRID.copy()
    a = smooth(prog(t, 36.4, 37.0))
    f = font(FONT_HEAD, 104)
    items = [
        ((960, 430), "Sorry, can't talk.", f, WHITE, "mm", a),
        ((960, 560), "I have somewhere to be.", f, LIME, "mm", a),
    ]
    base = Image.alpha_composite(base, text_layer(items))
    return bike_on(base, View(0, 0, 0.6, 960, 840), t * 2.0)


_fl = font(FONT_HEAD, 230)
LOGO_CAP = cap_height(_fl)
LOGO_X0 = 960 - _fl.getlength("VOLTARI") / 2
LOGO_BASE = 540 + LOGO_CAP / 2
O_CX = LOGO_X0 + _fl.getlength("V") + _fl.getlength("O") / 2
O_CY = LOGO_BASE - LOGO_CAP / 2
O_R = LOGO_CAP * 0.5


def scene7(t):
    """41-45 s: wheel morphs into the O of VOLTARI, tagline, end card."""
    oy = -140 * smooth(prog(t, 43.9, 44.4))
    base = BASE_GRID.copy()
    k = smooth(prog(t, 41.9, 42.9))
    cx = lerp(960, O_CX, k)
    cy = lerp(540, O_CY, k) + oy
    r = lerp(260, O_R, k)
    tyre_w = lerp(18, LOGO_CAP * 0.2, k)
    tyre_col = tuple(int(lerp(a, b, k)) for a, b in zip(WHITE, LIME))
    angle = t * 14 if t < 41.9 else 14 * 0.0 + (t - 41.9) * 2.0

    base = glow_1x(base, cx, cy, LOGO_CAP * 0.9, LIME, 0.55 * smooth(prog(t, 42.6, 43.4)))

    la = smooth(prog(t, 42.3, 43.0))
    items = []
    for i, ch in enumerate("VOLTARI"):
        if i == 1:  # the O is the wheel
            continue
        items.append(((LOGO_X0 + _fl.getlength("VOLTARI"[:i]), LOGO_BASE + oy), ch, _fl, WHITE, "ls", la))
    base = Image.alpha_composite(base, text_layer(items))

    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    draw_wheel(ImageDraw.Draw(layer), cx * SS, cy * SS, r * SS, angle, tyre_col=tyre_col,
               tyre_w=tyre_w * SS, spokes=16, spoke_col=WHITE)
    base = Image.alpha_composite(base, layer.resize((W, H), Image.LANCZOS))

    ft = font(FONT_MED, 58)
    at = smooth(prog(t, 43.2, 43.6)) * (1 - smooth(prog(t, 43.9, 44.2)))
    base = Image.alpha_composite(base, text_layer([((960, LOGO_BASE + oy + 120), "Go further than the traffic.", ft, WHITE, "ms", at)]))

    fe = font(FONT_MED, 60)
    ae = smooth(prog(t, 44.1, 44.5))
    parts = [("voltari.com.au", WHITE), ("   |   ", MUTED), ("From $2,490", LIME)]
    total = sum(fe.getlength(s) for s, _ in parts)
    x = 960 - total / 2
    ey = 680
    items = []
    for s, col in parts:
        items.append(((x, ey), s, fe, col, "ls", ae))
        x += fe.getlength(s)
    return Image.alpha_composite(base, text_layer(items))


def frame_image(t):
    if t < 6:
        return scene1(t)
    if t < 12:
        return scene2(t)
    if t < 20:
        return scene3(t)
    if t < 28:
        return scene4(t)
    if t < 36:
        return scene5(t)
    if t < 41:
        return scene6(t)
    return scene7(t)


def render_bytes(i):
    t = i / FPS
    img = frame_image(t).convert("RGB")
    arr = np.asarray(img, dtype=np.float32) * VIGNETTE
    grain = np.random.default_rng(i).normal(0.0, 2.0, arr.shape).astype(np.float32)  # 24 fps film grain
    return np.clip(arr + grain, 0, 255).astype(np.uint8).tobytes()


# ----------------------------------------------------------------- audio
def _lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def make_audio(path):
    SR = 44100
    n = SR * DUR
    t = np.arange(n) / SR
    rng = np.random.default_rng(5)
    gate = np.interp(t, [0, 5.5, 5.6, 6.6, 6.7, 13.9, 14.0, 15.0, 15.1, 39.9, 40.0, 41.4, 41.5, 45],
                     [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1])  # score drops out in VO pauses
    I = np.interp(t, [0, 6, 20, 36, 45], [0.35, 0.5, 0.8, 1.0, 1.0])  # quiet -> energetic

    music = np.zeros(n)
    pad_env = 0.05 * (0.6 + 0.4 * np.sin(2 * np.pi * t / 8)) * I
    for f in (110.0, 130.8, 164.8):
        music += np.sin(2 * np.pi * f * t) * pad_env / 3

    s16 = 60 / 124 / 4
    idx16 = np.floor(t / s16).astype(int)
    tau16 = t - idx16 * s16
    notes = np.array([440, 523.25, 659.25, 880, 659.25, 523.25, 440, 329.63])
    arp = np.sin(2 * np.pi * notes[idx16 % len(notes)] * t) * np.exp(-tau16 / 0.09)
    music += arp * 0.07 * I * (t >= 12)

    s8 = 60 / 124 / 2
    idx8 = np.floor(t / s8).astype(int)
    tau8 = t - idx8 * s8
    semis = np.array([0, 0, 12, 0, 3, 0, 7, 5])
    fb = 55 * 2 ** (semis[idx8 % 8] / 12)
    bass = sum(np.sin(2 * np.pi * h * fb * t) / h for h in (1, 2, 3)) * np.exp(-tau8 / 0.16)
    music += 0.22 * bass * I * (t >= 6)

    s4 = 60 / 124
    idk = np.floor(t / s4).astype(int)
    tauk = t - idk * s4
    kick_phase = 2 * np.pi * (45 * tauk + 75 * 0.03 * (1 - np.exp(-tauk / 0.03)))
    music += 0.8 * np.sin(kick_phase) * np.exp(-tauk / 0.18) * I * (t >= 6)

    noise = rng.standard_normal(n)
    hp = np.diff(noise, prepend=0.0)
    tauh = (t - s8 / 2) - np.floor((t - s8 / 2) / s8) * s8
    music += 0.10 * hp * np.exp(-tauh / 0.025) * I * (t >= 6)
    music *= gate

    sfx = np.zeros(n)
    amb = _lowpass(rng.standard_normal(n), 60) * 40
    amb_env = np.clip(np.interp(t, [0, 11, 12.5, 13], [1, 1, 1, 0]), 0, 1)
    sfx += amb * 0.05 * amb_env
    hum = _lowpass(rng.standard_normal(n), 25) * 30
    hum_env = np.interp(t, [11.8, 12.5, 19.5, 20.2], [0, 1, 1, 0])
    sfx += (hum * 0.10 + np.sin(2 * np.pi * 110 * t) * 0.02) * hum_env
    tc = t - 26.2
    on = (tc >= 0).astype(float)
    tcp = np.clip(tc, 0, None)  # avoid exp overflow before the click
    sfx += (rng.standard_normal(n) * np.exp(-tcp / 0.003) * 0.5 + np.sin(2 * np.pi * 2600 * tcp) * np.exp(-tcp / 0.008) * 0.4) * on

    mix = music + sfx
    mix = mix / np.max(np.abs(mix)) * 0.89
    stereo = np.stack([mix, mix], axis=1)
    pcm = (stereo * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ----------------------------------------------------------------- subtitles
VO_CUES = {
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


def _srt_time(s):
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


def write_srts():
    for lang, cues in VO_CUES.items():
        path = os.path.join(OUT, f"voiceover_subtitles_{lang}.srt")
        with open(path, "w", encoding="utf-8") as fh:
            for i, (a, b, text) in enumerate(cues, 1):
                fh.write(f"{i}\n{_srt_time(a)} --> {_srt_time(b)}\n{text}\n\n")


# ----------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, "score_and_sfx.wav")
    make_audio(wav)
    write_srts()
    mp4 = os.path.join(OUT, MP4_NAME)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", wav,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with get_context("fork").Pool(4) as pool:
        for raw in pool.imap(render_bytes, range(N), chunksize=8):
            proc.stdin.write(raw)
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print("wrote", mp4)


if __name__ == "__main__":
    main()
