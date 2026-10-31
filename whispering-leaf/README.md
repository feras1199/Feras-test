# Whispering Leaf: concept website and promo video

Fictional company. All names, projects, prices and contact details are placeholders.

## Files
| File | What it is |
|---|---|
| `index.html` | The whole site (HTML, CSS and JS inline). Loads `whispering-leaf-promo.mp4` from the same folder as the hero background. |
| `whispering-leaf-standalone.html` | The same site with the video embedded (base64). One file, opens anywhere. |
| `whispering-leaf-promo.mp4` | 7 s promo, 1280x720, 24 fps, H.264, no audio. |
| `video/render.py` | Python script that renders the video (needs numpy, Pillow, ffmpeg). |
| `tests/browser-test.js` | Playwright test script (29 checks, desktop and mobile). |

## Open the site
- Easiest: double-click `whispering-leaf-standalone.html`.
- Or keep `index.html` and the MP4 in the same folder and open `index.html`.
- Optional local server: `python3 -m http.server 8000`, then go to http://localhost:8000

No build step, no dependencies. Fonts (Fraunces, Inter) load from Google Fonts. Offline, the page falls back to Georgia and the system font.

## Re-render the video
    pip install numpy pillow   # ffmpeg must be on PATH
    python3 video/render.py whispering-leaf-promo.mp4

## Run the tests
    npm i playwright && npx playwright install chromium
    node tests/browser-test.js ./screenshots   # run from this folder; the screenshots folder must exist

## Limitations
- The quote form validates input but does NOT send or store anything.
- The client portal and "Message site lead" are static demos.
- Images are labelled colour placeholders, not photos.
- The video is procedurally drawn illustration, not photoreal footage.
