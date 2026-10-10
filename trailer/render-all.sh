#!/usr/bin/env bash
# Render all 600 frames with N parallel workers (each a headless Chromium).
set -euo pipefail
cd "$(dirname "$0")"
N="${N:-4}"
rm -rf .work/out
for ((w = 0; w < N; w++)); do
  node render.cjs $((600 * w / N)) $((600 * (w + 1) / N)) 1 > ".work/render-$w.log" 2>&1 &
done
wait
ls .work/out | wc -l
