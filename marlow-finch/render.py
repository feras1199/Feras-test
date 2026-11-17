"""Marlow & Finch 30s brand film: graphics renderer.

Renders, at 1920x1080 / 30 fps:
  build/overlay_text.mov  0-20 s, text-only layer with alpha (ProRes 4444), to drop over real footage
  build/endcard.mov       20-30 s, full-frame logo end card (ProRes 422 HQ)
  build/placeholder.mp4   0-20 s, stand-in backgrounds for the animatic (replace with real footage)

All on-screen copy lives in COPY below, so spelling is controlled in one place.
"""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
BUILD = os.path.join(HERE, "build")
os.makedirs(BUILD, exist_ok=True)

GREEN = (0x1F, 0x3D, 0x2B)
CREAM = (0xF5, 0xEF, 0xE0)
COPPER = (0xB8, 0x73, 0x33)
COPPER_HI = (0xF0, 0xC0, 0x8A)

COPY = {
    "s1": "18 hours.",
    "s2": "No shortcuts.",
    "s3": "Just something worth slowing down for.",
    "brand": ("Marlow", "&", "Finch"),
    "sub": "COFFEE",
    "tagline": "Slow roasted. Fast friends.",
    "url": "marlowandfinch.com.au",
}

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

SERIF = "playfair-display-latin-400-normal.ttf"
SERIF_SB = "playfair-display-latin-600-normal.ttf"
SERIF_IT = "playfair-display-latin-400-italic.ttf"
SANS = "inter-latin-400-normal.ttf"
SANS_MD = "inter-latin-500-normal.ttf"

# ---------- easing / helpers ----------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))

def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)

def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3

def ramp(t, t0, t1):
    return smooth((t - t0) / (t1 - t0))

def env(t, a0, a1, b0, b1):
    """fade in a0->a1, fade out b0->b1"""
    return ramp(t, a0, a1) * (1 - ramp(t, b0, b1))

def text_size(f, s, tracking=0):
    if tracking == 0:
        b = f.getbbox(s)
        return b[2] - b[0], b[3] - b[1]
    w = sum(f.getlength(c) for c in s) + tracking * (len(s) - 1)
    b = f.getbbox(s)
    return int(math.ceil(w)), b[3] - b[1]

def draw_tracked(d, xy, s, f, fill, tracking):
    x, y = xy
    for c in s:
        d.text((x, y), c, font=f, fill=fill)
        x += f.getlength(c) + tracking

def ffmpeg_writer(path, alpha=False, codec="prores"):
    pix_in = "rgba" if alpha else "rgb24"
    if alpha:
        enc = ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]
    elif codec == "prores":
        enc = ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]
    else:
        enc = ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p"]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", pix_in,
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", *enc,
           "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", path]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)

def shift(img, dx, dy):
    """sub-pixel translate (no integer stepping, so slow moves don't judder)"""
    return img.transform(img.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy), resample=Image.BICUBIC)

# ---------- scene 1-3 text cards ----------
def make_caption(text, size, align="center", y_frac=0.5, x_px=None):
    """Return full-frame RGBA layer with cream serif text + soft shadow + copper hairline."""
    f = font(SERIF, size)
    tw, th = text_size(f, text)
    bbox = f.getbbox(text)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if align == "center":
        x = (W - tw) // 2 - bbox[0]
    else:
        x = x_px - bbox[0]
    y = int(H * y_frac - th / 2) - bbox[1]
    # shadow for legibility on any footage
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + 3), text, font=f, fill=(10, 18, 12, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    layer.alpha_composite(sh)
    d = ImageDraw.Draw(layer)
    d.text((x, y), text, font=f, fill=CREAM + (255,))
    # copper hairline under text
    lw = min(140, tw // 3)
    ly = y + bbox[3] + int(size * 0.32)
    lx = (W - lw) // 2 if align == "center" else x + bbox[0]
    d.rectangle([lx, ly, lx + lw, ly + 2], fill=COPPER + (255,))
    return layer

CAPTIONS = [
    # layer, fade-in start, fade-in end, fade-out start, fade-out end
    (lambda: make_caption(COPY["s1"], 120, y_frac=0.50), 2.7, 3.7, 4.35, 4.95),
    (lambda: make_caption(COPY["s2"], 112, y_frac=0.50), 7.0, 7.9, 11.2, 11.85),
    (lambda: make_caption(COPY["s3"], 76, align="left", y_frac=0.80, x_px=150), 13.3, 14.4, 19.0, 19.75),
]

def render_overlay():
    layers = [(fn(), a0, a1, b0, b1) for fn, a0, a1, b0, b1 in CAPTIONS]
    # bottom scrim for the scene-3 lower third (helps cream text on sunny footage)
    scrim = np.zeros((H, W, 4), np.uint8)
    g = np.clip((np.arange(H) - H * 0.55) / (H * 0.45), 0, 1) ** 1.6
    scrim[..., 0:3] = (12, 20, 14)
    scrim[..., 3] = (g * 120).astype(np.uint8)[:, None]
    scrim = Image.fromarray(scrim, "RGBA")
    p = ffmpeg_writer(os.path.join(BUILD, "overlay_text.mov"), alpha=True)
    n = 20 * FPS
    blank = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i in range(n):
        t = i / FPS
        fr = blank.copy()
        s3 = env(t, 12.9, 14.0, 19.0, 19.9)
        if s3 > 0:
            sc = scrim.copy(); sc.putalpha(sc.getchannel("A").point(lambda v: int(v * s3)))
            fr.alpha_composite(sc)
        for lay, a0, a1, b0, b1 in layers:
            a = env(t, a0, a1, b0, b1)
            if a <= 0:
                continue
            rise = (1 - ease_out((t - a0) / (a1 - a0 + 0.6))) * 14  # gentle 14px settle
            l = shift(lay, 0, rise)
            if a < 1:
                l.putalpha(l.getchannel("A").point(lambda v, a=a: int(v * a)))
            fr.alpha_composite(l)
        p.stdin.write(fr.tobytes())
    p.stdin.close(); p.wait()

# ---------- end card ----------
def build_endcard_layers():
    """Returns dict of full-frame RGBA layers for the end card, plus copper mask."""
    # background: warm cream with a very soft vignette and faint paper texture (static -> no flicker)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H * 0.46) / (H * 0.62)) ** 2)
    v = np.clip(r, 0, 1.4) ** 2 * 0.06
    rng = np.random.default_rng(7)
    tex = Image.fromarray((rng.normal(0, 1, (H // 2, W // 2)) * 40 + 128).clip(0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))
    tex = (np.asarray(tex, np.float32) - 128) / 128 * 0.012
    bg = np.empty((H, W, 3), np.float32)
    for c in range(3):
        bg[..., c] = CREAM[c] / 255 * (1 - v) + tex
    bg = Image.fromarray((bg.clip(0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")

    word = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    copper = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fW = font(SERIF_SB, 136); fA = font(SERIF_IT, 136)
    a, amp, b = COPY["brand"]
    sp = fW.getlength(" ")
    total = fW.getlength(a) + sp + fA.getlength(amp) + sp + fW.getlength(b)
    x = (W - total) / 2
    base_y = 395  # top of glyph box
    dW = ImageDraw.Draw(word); dC = ImageDraw.Draw(copper)
    dW.text((x, base_y), a, font=fW, fill=GREEN + (255,)); x += fW.getlength(a) + sp
    dC.text((x, base_y), amp, font=fA, fill=COPPER + (255,)); x += fA.getlength(amp) + sp
    dW.text((x, base_y), b, font=fW, fill=GREEN + (255,))
    wb = word.getbbox(); cb = copper.getbbox()
    word_box = (min(wb[0], cb[0]), min(wb[1], cb[1]), max(wb[2], cb[2]), max(wb[3], cb[3]))

    # COFFEE with flanking copper rules
    sub = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ds = ImageDraw.Draw(sub)
    fS = font(SANS_MD, 26); trk = 14
    sw, shh = text_size(fS, COPY["sub"], trk)
    sy = word_box[3] + 38
    draw_tracked(ds, ((W - sw) / 2, sy), COPY["sub"], fS, GREEN + (255,), trk)
    rules = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dr = ImageDraw.Draw(rules)
    ry = sy + fS.getbbox("C")[1] + (fS.getbbox("C")[3] - fS.getbbox("C")[1]) / 2
    gap, rl = 34, 110
    dr.rectangle([W / 2 - sw / 2 - gap - rl, ry - 1, W / 2 - sw / 2 - gap, ry + 1], fill=COPPER + (255,))
    dr.rectangle([W / 2 + sw / 2 + gap, ry - 1, W / 2 + sw / 2 + gap + rl, ry + 1], fill=COPPER + (255,))

    tag = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fT = font(SERIF_IT, 50)
    tw, th = text_size(fT, COPY["tagline"]); tb = fT.getbbox(COPY["tagline"])
    ImageDraw.Draw(tag).text(((W - tw) / 2 - tb[0], sy + 118), COPY["tagline"], font=fT, fill=GREEN + (255,))

    url = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fU = font(SANS, 28); utrk = 3
    uw, uh = text_size(fU, COPY["url"], utrk)
    draw_tracked(ImageDraw.Draw(url), ((W - uw) / 2, 952), COPY["url"], fU, GREEN + (210,), utrk)
    return dict(bg=bg, word=word, copper=copper, sub=sub, rules=rules, tag=tag, url=url, word_box=word_box)

def scale_alpha(img, a):
    if a >= 1: return img
    out = img.copy(); out.putalpha(img.getchannel("A").point(lambda v: int(v * a))); return out

def wipe_mask(box, prog, feather=160):
    """left-to-right soft wipe across box; prog 0..1"""
    x0, x1 = box[0] - feather, box[2]
    edge = x0 + (x1 - x0 + feather) * prog
    xs = np.arange(W, dtype=np.float32)
    m = np.clip((edge - xs) / feather, 0, 1)
    return np.broadcast_to(m[None, :], (H, W))

def mask_layer(img, m):
    a = np.asarray(img.getchannel("A"), np.float32) * m
    out = img.copy(); out.putalpha(Image.fromarray(a.clip(0, 255).astype(np.uint8))); return out

def shimmer(copper_img, t, t0, dur):
    """moving diagonal highlight band over copper pixels"""
    if not (t0 <= t <= t0 + dur):
        return copper_img
    p = (t - t0) / dur
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    pos = -400 + (W + 800) * smooth(p)
    d = (xx + (yy - H / 2) * 0.45) - pos
    band = np.exp(-(d / 110) ** 2) * math.sin(math.pi * p)  # fades in and out, never pops
    arr = np.asarray(copper_img, np.float32).copy()
    for c in range(3):
        arr[..., c] = arr[..., c] * (1 - band) + COPPER_HI[c] * band
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA")

def endcard_frame(L, t):
    """t is time within the end card (0..10). Film time = 20 + t."""
    fr = L["bg"].copy()
    # soft copper glow pass across the background, once
    g = env(t, 2.0, 3.0, 3.2, 4.6)
    if g > 0:
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        pos = -300 + (W + 600) * smooth((t - 2.0) / 2.6)
        band = np.exp(-(((xx + (yy - H / 2) * 0.45) - pos) / 380) ** 2) * 0.10 * g
        glow = np.zeros((H // 4, W // 4, 4), np.uint8)
        glow[..., :3] = COPPER_HI; glow[..., 3] = (band * 255).astype(np.uint8)
        fr.alpha_composite(Image.fromarray(glow, "RGBA").resize((W, H), Image.BICUBIC))
    # wordmark: soft wipe + slight rise (VO "Marlow and Finch" lands ~21.6 s)
    wp = ease_out((t - 0.7) / 1.9)
    if wp > 0:
        m = wipe_mask(L["word_box"], wp)
        rise = (1 - ease_out((t - 0.7) / 2.4)) * 18
        cop = shimmer(L["copper"], t, 2.3, 1.6)
        for lay in (L["word"], cop):
            fr.alpha_composite(shift(mask_layer(lay, m), 0, rise))
    # COFFEE + rules grow from centre
    sa = ramp(t, 1.9, 2.8)
    if sa > 0:
        fr.alpha_composite(scale_alpha(L["sub"], sa))
        rp = ease_out((t - 1.9) / 1.3)
        cx = W / 2; xs = np.arange(W, dtype=np.float32)
        half = 300 * rp
        m = np.broadcast_to(np.clip((half - np.abs(xs - cx)) / 30, 0, 1)[None, :], (H, W))
        fr.alpha_composite(mask_layer(shimmer(L["rules"], t, 2.6, 1.6), m))
    # tagline in on the VO "Slow roasted" (~24.0 s => t=4.0)
    ta = ramp(t, 3.75, 4.75)
    if ta > 0:
        fr.alpha_composite(shift(scale_alpha(L["tag"], ta), 0, (1 - ease_out((t - 3.75) / 1.4)) * 12))
    ua = ramp(t, 6.4, 7.3)
    if ua > 0:
        fr.alpha_composite(scale_alpha(L["url"], ua))
    # very slow push-in over the whole card (1.000 -> 1.025)
    s = 1 + 0.025 * smooth(t / 10)
    if s != 1:
        cx, cy = W / 2, H / 2
        fr = fr.transform((W, H), Image.AFFINE, (1 / s, 0, cx - cx / s, 0, 1 / s, cy - cy / s), resample=Image.BICUBIC)
    return fr.convert("RGB")

def render_endcard():
    L = build_endcard_layers()
    p = ffmpeg_writer(os.path.join(BUILD, "endcard.mov"))
    for i in range(10 * FPS):
        p.stdin.write(endcard_frame(L, i / FPS).tobytes())
    p.stdin.close(); p.wait()
    endcard_frame(L, 9.9).save(os.path.join(BUILD, "endcard_still.png"))

# ---------- placeholder backgrounds (animatic only) ----------
def bean(d, cx, cy, rx, ry, ang, col, crease):
    pts = []
    for k in range(40):
        a = 2 * math.pi * k / 40
        x, y = rx * math.cos(a), ry * math.sin(a)
        pts.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    d.polygon(pts, fill=col)
    cpts = []
    for k in range(13):
        u = -0.75 + 1.5 * k / 12
        x, y = rx * u, ry * 0.12 * math.sin(u * 3.2)
        cpts.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    d.line(cpts, fill=crease, width=max(2, int(ry * 0.14)))

def radial(cx, cy, rx, ry, inner, outer, power=1.5):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.clip(np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2), 0, 1) ** power
    return (np.array(inner, np.float32)[None, None] * (1 - r[..., None]) + np.array(outer, np.float32)[None, None] * r[..., None])

def render_placeholder():
    rng = np.random.default_rng(3)
    s1_bg = radial(W * 0.72, H * 0.2, W * 0.9, H * 1.1, (92, 66, 44), (14, 10, 8))
    s2_bg = radial(W * 0.5, H * 0.55, W * 0.55, H * 0.75, (196, 122, 58), (36, 18, 8), 1.2)
    s3_bg = radial(W * 0.35, H * 0.3, W * 0.9, H * 0.9, (250, 222, 170), (150, 110, 70), 1.3)
    bok = Image.new("RGBA", (W + 400, H), (0, 0, 0, 0)); db = ImageDraw.Draw(bok)
    for _ in range(40):
        x, y, r = rng.uniform(0, W + 400), rng.uniform(0, H * 0.7), rng.uniform(30, 110)
        db.ellipse([x - r, y - r, x + r, y + r], fill=(255, 245, 215, int(rng.uniform(25, 70))))
    bok = bok.filter(ImageFilter.GaussianBlur(6))
    falling = [(rng.uniform(300, W - 300), rng.uniform(-2.5, 0), rng.uniform(26, 40), rng.uniform(0, 6.28), rng.uniform(-0.6, 0.6)) for _ in range(28)]
    drum = [(rng.uniform(0, 6.28), rng.uniform(80, 330), rng.uniform(22, 34), rng.uniform(0, 6.28)) for _ in range(90)]
    p = ffmpeg_writer(os.path.join(BUILD, "placeholder.mp4"), codec="h264")
    frames = {}
    def scene(k, t):
        if k == 1:
            im = Image.fromarray(s1_bg.astype(np.uint8)).convert("RGB")
            z = 1 + 0.04 * t / 5
            d = ImageDraw.Draw(im)
            for (x, y0, r, a, spin) in falling:
                y = (y0 + t * 0.22) * H + H * 0.1  # slow-motion fall
                if -60 < y < H * 0.82:
                    bean(d, W / 2 + (x - W / 2) * z, y, r * z, r * 0.68 * z, a + spin * t, (78, 44, 22), (32, 16, 8))
            d.rectangle([0, int(H * 0.82), W, H], fill=(20, 14, 10))
            return im.filter(ImageFilter.GaussianBlur(0.8))
        if k == 2:
            im = Image.fromarray(s2_bg.astype(np.uint8)).convert("RGB"); d = ImageDraw.Draw(im)
            for (a0, rr, r, sp) in drum:
                a = a0 + t * 0.55
                bean(d, W / 2 + rr * 1.6 * math.cos(a), H * 0.58 + rr * 0.7 * math.sin(a), r, r * 0.68, sp + t * 2, (92, 50, 24), (40, 20, 8))
            return im.filter(ImageFilter.GaussianBlur(1.2))
        im = Image.fromarray(s3_bg.astype(np.uint8)).convert("RGBA")
        im.alpha_composite(bok.crop((int(40 * t), 0, int(40 * t) + W, H)))
        d = ImageDraw.Draw(im)
        cx, cy = W * 0.5 + 10 * t, H * 0.62
        d.ellipse([cx - 230, cy + 120, cx + 230, cy + 170], fill=(235, 228, 214))  # saucer
        d.rounded_rectangle([cx - 150, cy - 90, cx + 150, cy + 140], 60, fill=(245, 239, 224))  # cup
        d.ellipse([cx - 150, cy - 115, cx + 150, cy - 65], fill=(120, 72, 38))  # crema
        d.arc([cx + 120, cy - 40, cx + 220, cy + 70], -80, 80, fill=(245, 239, 224), width=22)
        return im.convert("RGB")
    for i in range(20 * FPS):
        t = i / FPS
        # dissolves at 5.0 and 12.0 (0.6 s), never hard cuts
        if t < 4.7:
            fr = scene(1, t)
        elif t < 5.3:
            fr = Image.blend(scene(1, t), scene(2, t - 5), smooth((t - 4.7) / 0.6))
        elif t < 11.7:
            fr = scene(2, t - 5)
        elif t < 12.3:
            fr = Image.blend(scene(2, t - 5), scene(3, t - 12), smooth((t - 11.7) / 0.6))
        else:
            fr = scene(3, t - 12)
        p.stdin.write(fr.tobytes())
    p.stdin.close(); p.wait()

if __name__ == "__main__":
    which = sys.argv[1:] or ["overlay", "endcard", "placeholder"]
    for w in which:
        print("rendering", w, flush=True)
        {"overlay": render_overlay, "endcard": render_endcard, "placeholder": render_placeholder}[w]()
    print("done")
