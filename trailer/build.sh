#!/usr/bin/env bash
# Full pipeline: capture → track → render → audio → encode.  Needs `npm run dev` running in the repo root.
# Key art: place the user-supplied images in .work/keyart/ (1.png … 5.webp) before running.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
STEP="${1:-all}"

if [[ "$STEP" == all || "$STEP" == capture ]]; then
  node capture/shot-plate.cjs
  node capture/shot-main.cjs
  node capture/shot-hammer.cjs
fi
if [[ "$STEP" == all || "$STEP" == keyart ]]; then
  python3 keyart.py
fi
if [[ "$STEP" == all || "$STEP" == render ]]; then
  python3 track.py launch hammer
  python3 manifest.py
  ./render-all.sh
fi
if [[ "$STEP" == all || "$STEP" == audio ]]; then
  node -e 'import("./compose/cues.js").then(m => process.stdout.write(JSON.stringify(m.default)))' > .work/cues.json
  python3 audio/sfx.py
fi
if [[ "$STEP" == all || "$STEP" == encode ]]; then
  mkdir -p out
  ffmpeg -y -hide_banner -loglevel error -framerate 30 -i .work/out/%05d.png -i .work/audio.wav \
    -map 0:v -map 1:a -c:v libx264 -preset slow -crf 16 -profile:v high -pix_fmt yuv420p -tune film \
    -x264-params keyint=30 -c:a aac -b:a 256k -frames:v 600 -t 20 -movflags +faststart \
    out/ragdoll-ai-chaos-engine.mp4
  ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,nb_frames -of compact out/ragdoll-ai-chaos-engine.mp4
fi
