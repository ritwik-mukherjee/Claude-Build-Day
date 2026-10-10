# RAGDOLL.AI — CHAOS ENGINE · launch film

A 20-second, 1920×1080, 30 fps launch trailer built from **real in-engine captures** of the game, plus user-supplied key art for the opening and roster beats. Everything here is isolated from the game: nothing in `src/`, `server/` or `shared/` is modified.

Output: [`out/ragdoll-ai-chaos-engine.mp4`](out/ragdoll-ai-chaos-engine.mp4)

## Beats

| Time | Beat | Source |
|---|---|---|
| 0.0–2.5 | **Hook:** pulsing rings over a clean arena plate, wordmark snap, "WHAT IF WORDS COULD BREAK PHYSICS?" | real arena (HUD hidden) + Kratos key art |
| 2.5–6.0 | **Prompt:** push into the console; `GIVE MY GOBLIN SIX ROCKET BOOSTERS.` is typed and compiled | real capture |
| 6.0–11.0 | **Transformation:** the Three.js Mutation Chamber builds the 6× booster rack (`✓ MOUNTED` from the real executor), ignition, portal back to the arena, launch | real capture |
| 11.0–16.0 | **Payoff:** rocket flight, the Director's laser countermeasure, rocket chain-hammer slams on the Arachnotron | real capture |
| 16.0–17.7 | **Intelligence:** the actual AI Director line and mutation timeline | real capture |
| 17.7–20.0 | **Roster flash + brand:** Hulk / Kratos / Doraemon / spider key art, then the wordmark and tagline | user-supplied key art + motion graphics |

## Honesty notes

- No API key was configured, so the mutation compiler and the Director ran on the game's **deterministic fallback**. The footage shows this as it appears in the game: the `FALLBACK` timeline badge, `PLAN · FALLBACK` in the chamber, the `LOCAL` Director tag and `LINK: NO API KEY · LOCAL FALLBACK`. The end card says so in fine print. Nothing in the film claims a live Sonnet or Opus call.
- **Network latency is the only thing simulated.** The `/api/mutate` response (the real server's response) is held for about 0.75 s so the real `COMPILING MUTATION…` UI is visible on screen.
- The key art (`.work/keyart`, not committed) is used only as cinematic plates: the hook background and the roster flash. It is never presented as gameplay. Storyboard panels that depict UI or features the game doesn't have (the prompt box, the victory stats, the Director portrait) are not used.

## How it's made

1. **Capture** (`capture/`): Playwright drives the real game (`npm run dev`) with real keyboard and mouse input. `virtual-time.js` replaces the page's clocks (`performance.now`, `Date.now`, `requestAnimationFrame`, timers, CSS animations) with a virtual clock. The driver advances it 1/30 s per screenshot, so slow software WebGL still yields perfectly smooth, true-speed footage. `Math.random` is seeded, so a shot can be reproduced.
   - `shot-main.cjs`: prompt → chamber → launch → Director reaction (3200×1800)
   - `shot-hammer.cjs`: the same six-booster build plus a rocket-powered chain hammer, both entered through the real prompt pipeline, then hammer slams on the Arachnotron. The Chamber is skipped by clicking it, which the game supports; the plan is still applied for real.
   - `shot-plate.cjs`: clean arena plate (HUD hidden) for the hook
2. **Track** (`track.py`): finds the goblin and spider in each frame so the virtual camera can follow the action. Newer captures also record per-frame game state (positions, spider HP, hit-stop) in `meta.json`, and that state locates the hammer impact frames.
3. **Compose** (`compose/`): a canvas compositor. `renderFrame(t)` is a pure function of time. It applies time remaps, a virtual camera, grading, bloom, impact punches, grain and typography (Orbitron / Share Tech Mono, the game's own fonts). `cues.js` is the single source of timing for both picture and sound.
4. **Sound** (`audio/sfx.py`): original synthesized score and SFX (numpy only, no samples), driven by the same cue sheet.
5. **Render** (`render-all.sh`): 4 parallel headless Chromium workers write `.work/out/*.png`.
6. **Encode** (`build.sh`): H.264 High, CRF 16, yuv420p, AAC 256k, exactly 600 frames.

```bash
npm run dev                      # in the repo root, in another terminal
cd trailer && ./build.sh         # capture → track → render → audio → encode
```

Requires Node 20+, Playwright with Chromium, Python 3 + numpy + Pillow, and ffmpeg. Put the key-art images in `.work/keyart/` first (see `build.sh`).
