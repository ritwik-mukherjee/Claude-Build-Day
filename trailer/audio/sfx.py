"""Original synthesized sound design for the trailer (numpy only, no samples).

Reads .work/cues.json (exported from compose/cues.js) (the same cue sheet the compositor uses for impacts and cuts) and
writes .work/audio.wav (48 kHz stereo, exactly 20 s).
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
DUR = 20.0
N = int(SR * DUR)
ROOT = Path(__file__).resolve().parent.parent
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)


def tt(n):
    return np.arange(n) / SR


def add(sig, t0, gain=1.0, pan=0.0):
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    sig = sig[: N - i0]
    gl = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    gr = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    L[i0 : i0 + len(sig)] += sig * gain * gl
    R[i0 : i0 + len(sig)] += sig * gain * gr


def band(sig, lo, hi):
    """FFT brick-ish band-pass with soft edges."""
    F = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    m = np.ones_like(f)
    if lo > 0:
        m *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi < SR / 2:
        m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(F * m, len(sig))


def env(n, a, d, curve=4.0):
    t = tt(n)
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) * curve / max(d, 1e-4))
    return e


def norm(x):
    m = np.max(np.abs(x)) or 1
    return x / m


# ------------------------------------------------------------------ instruments
def sub_hit(dur=1.4, f0=110, f1=32):
    n = int(SR * dur)
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * 18)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.002, dur, 3.2)


def noise_burst(dur, lo, hi, a=0.001, curve=6):
    n = int(SR * dur)
    return norm(band(rng.standard_normal(n), lo, hi)) * env(n, a, dur, curve)


def metal(dur=1.2, base=180):
    n = int(SR * dur)
    t = tt(n)
    s = sum(np.sin(2 * np.pi * base * r * t + rng.uniform(0, 6)) * w for r, w in [(1, 1), (2.76, 0.6), (5.4, 0.4), (8.93, 0.25), (13.3, 0.15)])
    return s * env(n, 0.001, dur, 5)


def impact(power=1.0):
    s = sub_hit(1.6, 120, 30) * 1.0
    s[: int(SR * 0.6)] += noise_burst(0.6, 200, 6000, curve=9) * 0.7
    m = metal(1.0, 140 + 40 * power)
    s[: len(m)] += m * 0.25
    return s * power


def whoosh(dur=0.6, rising=True):
    n = int(SR * dur)
    x = rng.standard_normal(n)
    # sweep by cross-fading three bands
    t = tt(n) / dur
    k = t if rising else 1 - t
    lo = band(x, 150, 900)
    mid = band(x, 700, 3500)
    hi = band(x, 3000, 12000)
    s = lo * (1 - k) + mid * (1 - abs(k - 0.5) * 2) + hi * k
    e = np.sin(np.pi * np.clip(t, 0, 1)) ** (2 if rising else 1.2)
    if rising:
        e = t**2.2
    return norm(s) * e


def riser(dur=1.5, f0=80, f1=900):
    n = int(SR * dur)
    t = tt(n)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    s = band(saw, 60, 5000) * 0.5 + whoosh(dur, True) * 0.6
    return s * (t / dur) ** 1.6


def click():
    n = int(SR * 0.025)
    s = band(rng.standard_normal(n), 2000, 9000) * env(n, 0.0005, 0.02, 9)
    s += np.sin(2 * np.pi * 1900 * tt(n)) * env(n, 0.0005, 0.01, 9) * 0.3
    return norm(s)


def blip(f=1400, dur=0.07):
    n = int(SR * dur)
    t = tt(n)
    return np.sign(np.sin(2 * np.pi * f * t)) * 0.3 * env(n, 0.002, dur, 6) + np.sin(2 * np.pi * f * 2 * t) * 0.2 * env(n, 0.001, dur, 8)


def laser():
    n = int(SR * 0.22)
    t = tt(n)
    f = 1800 * np.exp(-t * 14) + 180
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sign(np.sin(ph)) * env(n, 0.002, 0.22, 4) * 0.5


def roar(dur):
    n = int(SR * dur)
    x = np.cumsum(rng.standard_normal(n))
    x = x - np.convolve(x, np.ones(2000) / 2000, mode="same")  # remove drift (brown noise, high-passed)
    s = norm(band(x, 40, 1600)) * 0.8 + noise_burst(dur, 900, 5000, curve=0.01) * 0.25
    flutter = 1 + 0.25 * np.sin(2 * np.pi * 23 * tt(n)) * rng.uniform(0.5, 1, n)
    e = np.minimum(1, tt(n) / 0.05) * np.minimum(1, (dur - tt(n)) / 0.25)
    return s * flutter * e


def kick():
    n = int(SR * 0.45)
    t = tt(n)
    f = 45 + 140 * np.exp(-t * 35)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.45, 5)
    s[:300] += rng.standard_normal(300) * np.linspace(0.4, 0, 300)
    return s


def bass_note(f, dur):
    n = int(SR * dur)
    t = tt(n)
    ph = 2 * np.pi * f * t
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    s = band(saw + 0.5 * np.sin(ph / 2), 30, 420)
    return s * env(n, 0.005, dur, 3)


def drone(dur, f=55):
    n = int(SR * dur)
    t = tt(n)
    lfo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t)
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.003 * t) + 0.25 * np.sin(2 * np.pi * f * 3.01 * t)) * lfo
    s += band(rng.standard_normal(n), 60, 300) * 0.25
    return s


def reverb(x, secs=2.2, wet=0.25):
    n = int(SR * secs)
    ir = rng.standard_normal(n) * np.exp(-tt(n) * 6 / secs)
    ir = band(ir, 200, 7000)
    ir /= np.sqrt(np.sum(ir**2))
    m = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]
    return x + y * wet


# ------------------------------------------------------------------ score from the cue sheet
cues = json.loads((ROOT / ".work" / "cues.json").read_text())

for c in cues["events"]:
    k, t = c["type"], c["t"]
    g = c.get("gain", 1.0)
    p = c.get("pan", 0.0)
    if k == "impact":
        add(impact(c.get("power", 1.0)), t, 0.9 * g, p)
    elif k == "hit":
        add(sub_hit(0.9, 160, 40) + noise_burst(0.9, 300, 8000, curve=10) * 0.5, t, 0.7 * g, p)
    elif k == "whoosh":
        d = c.get("dur", 0.5)
        add(whoosh(d, c.get("rising", True)), t - (d if c.get("rising", True) else 0), 0.45 * g, p)
    elif k == "riser":
        add(riser(c["dur"], c.get("f0", 80), c.get("f1", 900)), t - c["dur"], 0.5 * g, p)
    elif k == "click":
        add(click(), t, 0.22 * g, rng.uniform(-0.2, 0.2))
    elif k == "blip":
        add(blip(c.get("f", 1400)), t, 0.18 * g, p)
    elif k == "laser":
        add(laser(), t, 0.25 * g, p)
    elif k == "roar":
        add(roar(c["dur"]), t, 0.5 * g, p)
    elif k == "metal":
        add(metal(0.8, c.get("f", 220)), t, 0.3 * g, p)
    elif k == "drone":
        add(drone(c["dur"], c.get("f", 55)) * np.minimum(1, np.minimum(tt(int(SR * c["dur"])) / c.get("fade_in", 0.5), (c["dur"] - tt(int(SR * c["dur"]))) / c.get("fade_out", 0.5))), t, 0.18 * g, p)

# rhythmic bed: kick + bass on a grid between the music cues
m = cues["music"]
bpm = m["bpm"]
beat = 60 / bpm
notes = m["bass"]
t = m["start"]
i = 0
while t < m["end"] - 1e-6:
    if not any(a <= t < b for a, b in m.get("mute", [])):
        add(kick(), t, 0.42)
        add(bass_note(notes[(i // 4) % len(notes)], beat * 0.5), t + beat / 2, 0.3)
        if i % 2 == 1:
            add(noise_burst(0.08, 6000, 14000, curve=12), t + beat / 2, 0.06, 0.3)
    t += beat
    i += 1

mix_l = reverb(L, 2.4, 0.22)
mix_r = reverb(R, 2.6, 0.22)
mix = np.stack([mix_l, mix_r], 1)
# gentle bus compression (soft clip) and fades
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
fade = np.ones(N)
fade[: int(SR * 0.05)] = np.linspace(0, 1, int(SR * 0.05))
fade[-int(SR * 0.4) :] = np.linspace(1, 0, int(SR * 0.4))
mix *= fade[:, None]
mix = mix / np.max(np.abs(mix)) * 0.89

out = ROOT / ".work" / "audio.wav"
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("wrote", out, file=sys.stderr)
