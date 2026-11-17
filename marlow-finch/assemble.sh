#!/usr/bin/env bash
# Assemble the 30 s Marlow & Finch film at 1920x1080 / 30 fps.
#
#   ./assemble.sh                 -> animatic using placeholder visuals + scratch VO
#   ./assemble.sh final           -> uses footage/scene1.mp4, scene2.mp4, scene3.mp4 and vo/vo_final.wav
#
# Footage needs: scene1 >= 5.4 s, scene2 >= 7.6 s, scene3 >= 8.4 s (any res, it is scaled/cropped to 16:9 1080p).
# Final VO: one WAV, 30 s long, lines placed on the cues in audio.py (VO_CUES), or edit the adelay below.
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-animatic}"
B=build; mkdir -p out

if [[ "$MODE" == "final" ]]; then
  for f in footage/scene1.mp4 footage/scene2.mp4 footage/scene3.mp4 vo/vo_final.wav; do
    [[ -f $f ]] || { echo "missing $f"; exit 1; }
  done
  # scale/crop each scene, dissolve 0.6 s at 5.0 s and 12.0 s (no hard cuts), light warm grade
  NORM="scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1,format=yuv420p"
  ffmpeg -y -loglevel error \
    -i footage/scene1.mp4 -i footage/scene2.mp4 -i footage/scene3.mp4 -filter_complex "
    [0:v]trim=0:5.3,setpts=PTS-STARTPTS,$NORM[a];
    [1:v]trim=0:7.6,setpts=PTS-STARTPTS,$NORM[b];
    [2:v]trim=0:8.4,setpts=PTS-STARTPTS,$NORM[c];
    [a][b]xfade=transition=fade:duration=0.6:offset=4.7[ab];
    [ab][c]xfade=transition=fade:duration=0.6:offset=11.7,trim=0:20.4,
      colorbalance=rs=0.03:gs=0.01:bs=-0.03:rm=0.02:bm=-0.02,eq=saturation=1.05[v]" \
    -map "[v]" -c:v libx264 -crf 14 -preset medium -an $B/bg.mp4
  VO=vo/vo_final.wav; OUT=out/marlow-finch_30s_1080p.mp4
else
  ffmpeg -y -loglevel error -i $B/placeholder.mp4 -vf "tpad=stop_mode=clone:stop_duration=0.4" \
    -c:v libx264 -crf 14 -an $B/bg.mp4
  VO=$B/vo_scratch.wav; OUT=out/marlow-finch_30s_1080p_ANIMATIC.mp4
fi

# picture: text layer over 0-20 s, 0.8 s dissolve into the end card (end card t=0 at 19.6 s)
# audio: music ducked under the VO (sidechain), + SFX + VO, normalised to -14 LUFS / -1 dBTP for online
ffmpeg -y -loglevel error \
  -i $B/bg.mp4 -i $B/overlay_text.mov -i $B/endcard.mov \
  -i $B/music.wav -i $B/sfx.wav -i "$VO" \
  -filter_complex "
  [1:v]tpad=stop_mode=add:stop_duration=0.4:color=black@0,format=yuva444p10le[ov];
  [0:v][ov]overlay=0:0:format=auto,format=yuv420p,trim=0:20.4,setpts=PTS-STARTPTS[pre];
  [2:v]format=yuv420p,setpts=PTS-STARTPTS[ec];
  [pre][ec]xfade=transition=fade:duration=0.8:offset=19.6,tpad=stop_mode=clone:stop_duration=1,trim=0:30,setsar=1[v];
  [5:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vo][key];
  [3:a][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450:makeup=1[mduck];
  [mduck]volume=0.8[m];
  [4:a]volume=1.0[s];
  [m][s][vo]amix=inputs=3:normalize=0:duration=longest,atrim=0:30,
    loudnorm=I=-14:TP=-1:LRA=9,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -profile:v high -crf 16 -preset slow -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 30 \
  -c:a aac -b:a 256k -movflags +faststart -t 30 "$OUT"

echo "wrote $OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact "$OUT"
