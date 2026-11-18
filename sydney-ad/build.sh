#!/bin/bash
set -e
cd /home/user/calesthio
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
D=5.1; X=0.6; FPS=30
FR=$(python3 -c "print(int($D*$FPS))")
ken(){ echo "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0007,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$FR:s=1920x1080:fps=$FPS,format=yuv420p,setsar=1"; }
cap(){ # text start end
 echo "drawtext=fontfile=$F:text='$1':fontsize=72:fontcolor=white:borderw=4:bordercolor=black@0.6:x=(w-text_w)/2:y=h-220:enable='between(t,$2,$3)'"; }
ffmpeg -y -loglevel error \
 -loop 1 -t $D -i img/01.jpg -loop 1 -t $D -i img/02.jpg -loop 1 -t $D -i img/03.jpg \
 -loop 1 -t $D -i img/04.jpg -loop 1 -t $D -i img/05.jpg -loop 1 -t $D -i img/06.jpg \
 -i narration.wav \
 -filter_complex "
 [0:v]$(ken)[v0];[1:v]$(ken)[v1];[2:v]$(ken)[v2];[3:v]$(ken)[v3];[4:v]$(ken)[v4];[5:v]$(ken)[v5];
 [v0][v1]xfade=transition=fade:duration=$X:offset=4.5[x1];
 [x1][v2]xfade=transition=fade:duration=$X:offset=9.0[x2];
 [x2][v3]xfade=transition=fade:duration=$X:offset=13.5[x3];
 [x3][v4]xfade=transition=fade:duration=$X:offset=18.0[x4];
 [x4][v5]xfade=transition=fade:duration=$X:offset=22.5[xv];
 [xv]$(cap 'SYDNEY' 0.3 4.8)[t0];
 [t0]$(cap 'Sail past the Opera House' 4.8 9.3)[t1];
 [t1]$(cap 'Cross the Harbour Bridge at dusk' 9.3 13.8)[t2];
 [t2]$(cap 'Watch the city light up' 13.8 18.3)[t3];
 [t3]$(cap 'Stroll Darling Harbour' 18.3 22.8)[t4];
 [t4]$(cap 'Plan your trip today' 22.8 27.4)[t5];
 [t5]drawtext=fontfile=$F:text='Photos: Wikimedia Commons (CC BY-SA / CC0), see credits.txt':fontsize=22:fontcolor=white@0.85:x=20:y=h-40[vout];
 [6:a]adelay=1500|1500,apad,atrim=0:30,afade=t=out:st=27:d=3,volume=1.2[aout]" \
 -map "[vout]" -map "[aout]" -t 30 -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -movflags +faststart sydney_ad_30s_16x9.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 sydney_ad_30s_16x9.mp4
