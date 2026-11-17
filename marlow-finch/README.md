# Marlow & Finch Coffee: 30 s brand film (16:9, 1080p)

## Status

| Element | State |
|---|---|
| On-screen text (scenes 1 to 3), 1080p with alpha | **Final.** `build/overlay_text.mov` |
| Logo end card (20 to 30 s): wordmark, copper shimmer, tagline, URL | **Final.** `build/endcard.mov` |
| Music bed (fingerpicked acoustic, 72 bpm) + SFX (beans, roaster, steam, cafe, cup clink, chime) | **Usable draft.** Synthesized in code. Swap in a licensed acoustic track if you want a richer sound. |
| Timing, dissolves, VO ducking, loudness (-14 LUFS, -1 dBTP) | **Final.** `assemble.sh` |
| Live-action footage, scenes 1 to 3 | **Missing.** Placeholder illustrations in the animatic. Prompts below. |
| Voice-over (female, Australian) | **Missing.** Scratch VO is a British synthetic voice (Piper "cori"), used for timing only. |

`out/marlow-finch_30s_1080p_ANIMATIC.mp4` is the full 30 s cut with placeholders, for timing and sign-off.

## Rebuild

```bash
python3 render.py            # graphics (~4 min)
python3 audio.py <dir with l0..l7.wav scratch lines>
./assemble.sh                # animatic
./assemble.sh final          # needs footage/scene{1,2,3}.mp4 + vo/vo_final.wav
```

Needs ffmpeg, Python 3, numpy, scipy and Pillow. Fonts are in `fonts/`: Playfair Display (headlines) and Inter (small text), both SIL OFL.

## Timing grid (everything locks to this)

| Time (s) | Picture | VO | Text |
|---|---|---|---|
| 0.0 to 5.0 | S1 beans falling, slow-mo, dark surface, morning light | 0.8 "Good coffee takes time." / 2.9 "Eighteen hours of slow roasting, to be exact." | "18 hours." 2.7 to 4.95 |
| 4.7 to 5.3 | dissolve | | |
| 5.0 to 12.0 | S2 beans tumbling in copper roasting drum, steam | 7.1 "No shortcuts." / 9.0 "No burnt beans." | "No shortcuts." 7.0 to 11.85 |
| 11.7 to 12.3 | dissolve | | |
| 12.0 to 20.0 | S3 two friends laughing, sunny cafe table, cup in focus | 13.4 "Just something worth slowing down for." | lower third 13.3 to 19.75 |
| 19.6 to 20.4 | dissolve to cream | | |
| 20.0 to 30.0 | End card | 21.5 "Marlow and Finch." / 23.9 "Slow roasted." / 25.5 "Fast friends." | wordmark ~20.3, tagline ~23.4, URL ~26.0 |

Cup clink SFX sits at 15.6 s. If the footage puts the cup down somewhere else, move it in `audio.py`.

## Footage prompts (for Veo, Kling, Runway, Sora, Seedance etc.)

Ask for **no text, no logos, no watermarks** in every shot. All the text gets added in post, so generated lettering never reaches the film. Generate at least 6 s / 8 s / 9 s so there are handles for the dissolves.

**Look line (paste into every prompt):** warm cinematic grade, soft golden morning light, 50mm, shallow depth of field, creamy bokeh, gentle film grain, deep forest green and copper accents, no text, no logos, no watermark.

1. **Scene 1, 6 s:** Extreme close-up macro of medium-roast coffee beans falling in slow motion (120 fps look) onto a dark walnut surface, landing softly and settling. Soft directional morning light from the upper right catches the oily sheen on the beans. Very slow push-in, locked focus plane. + look line.
2. **Scene 2, 8 s:** Inside a traditional copper drum coffee roaster, beans tumbling in a slow rolling motion, warm amber glow from the burner, light wisps of steam and smoke curling up through a shaft of light. Slow lateral dolly along the drum. + look line.
3. **Scene 3, 9 s:** A sunny Sydney cafe table by a window, two friends in their early 30s sharing a laugh. They are soft in the background, hands relaxed. In the foreground, a ceramic flat white in a cream cup on a saucer, in sharp focus, latte art visible. Slow push-in toward the cup. Natural, relaxed, candid. + look line. *Negative: distorted hands, extra fingers, warped faces, text, signage, logos.*

Check each clip before use for hands, faces, flicker and any stray lettering on cups or signage. Reject a take rather than fixing it in post.

## Voice-over brief

Female, 28 to 40, natural Australian accent (not broad), warm and calm, a small smile in the voice. Unhurried, with a real pause after "time." and after "exact." "Marlow and Finch." should land as a sign-off, not a sell. Script, word for word:

> Good coffee takes time. Eighteen hours of slow roasting, to be exact. No shortcuts. No burnt beans. Just something worth slowing down for. Marlow and Finch. Slow roasted. Fast friends.

Deliver as one 48 kHz WAV, 30.0 s long, with each line starting on the cue in the timing grid (`vo/vo_final.wav`). A local voice artist will beat TTS for "small smile in the voice". ElevenLabs has Australian female stock voices if budget is tight.

## Brand checks already done

- Every on-screen string comes from `COPY` in `render.py`, rendered from real fonts, so no AI-generated lettering is involved.
- Colours: #1F3D2B green, #F5EFE0 cream, #B87333 copper (shimmer highlight #F0C08A).
- No hard cuts. The two scene changes are 0.6 s dissolves and the end card comes in on a 0.8 s dissolve. Text fades over 0.6 to 1.1 s with a sub-pixel settle, and the backgrounds use no animated grain, so nothing flickers.
- One open question: "18 hours." on screen next to "Eighteen hours" in the VO is from the brief. Only claim it if the roast really takes that long (Australian Consumer Law).
