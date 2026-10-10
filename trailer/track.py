"""Pixel tracker for captures without per-frame meta: finds the Mech Goblin (its green head/arms)
and the Arachnotron (its red eye cluster) in each frame → .work/track/<segment>.json
(normalized coords, smoothed). Usage: python3 track.py launch hammer"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent / ".work"


def smooth(xs, k=5):
    xs = np.array(xs, dtype=float)
    for j in range(xs.shape[1]):
        col = xs[:, j]
        ok = ~np.isnan(col)
        if ok.sum() == 0:
            continue
        col[~ok] = np.interp(np.flatnonzero(~ok), np.flatnonzero(ok), col[ok])
        pad = np.pad(col, k, mode="edge")
        xs[:, j] = np.convolve(pad, np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
    return xs


for seg in sys.argv[1:]:
    files = sorted((ROOT / "frames" / seg).glob("*.jpg"))
    g, s = [], []
    for f in files:
        im = np.asarray(Image.open(f).convert("RGB").resize((400, 225))).astype(int)
        r, gg, b = im[..., 0], im[..., 1], im[..., 2]
        H, W = r.shape
        yy, xx = np.mgrid[0:H, 0:W]
        play = (yy > H * 0.2) & (yy < H * 0.86) & (xx > W * 0.03) & (xx < W * 0.97)
        green = play & (gg > 120) & (gg - r > 35) & (gg - b > 50)
        red = play & (r > 190) & (gg < 80) & (b < 90)
        g.append([xx[green].mean() / W, yy[green].mean() / H] if green.sum() > 3 else [np.nan, np.nan])
        # spider eye: densest red cluster (lasers are thin lines; use the median, robust to them)
        s.append([np.median(xx[red]) / W, np.median(yy[red]) / H] if red.sum() > 3 else [np.nan, np.nan])
    out = {"goblin": smooth(g).round(4).tolist(), "spider": smooth(s).round(4).tolist()}
    (ROOT / "track").mkdir(exist_ok=True)
    (ROOT / "track" / f"{seg}.json").write_text(json.dumps(out))
    print(seg, len(files), out["goblin"][:: max(1, len(files) // 8)])
