# RAGDOLL.AI

Prompt-driven 2D physics combat. You pilot a mechanical goblin ragdoll in an industrial arena against a mechanical spider. Type what you want ("give my goblin giant rocket boosters") and an LLM compiles it into a **validated mutation plan** built from a fixed library of physical components. The plan then plays as a cinematic: a schematic appears, parts fly in and bolt on, and the boosters ignite. A second model acts as the **AI Director**: it watches combat summaries and triggers countermeasures and arena events.

Stack: TypeScript · Phaser 4 (Matter.js physics) · three.js (lazy-loaded cinematic) · Vite · Node/Express · Anthropic SDK · Zod.

## What's in it

- **Four original fighters** on one shared active-ragdoll rig, each with its own proportions, physics profile and special (**F**):

  | Fighter | Profile | Special |
  |---|---|---|
  | Mech Goblin | balanced | Scrap Bomb |
  | The Diva | fast, double jump | Sonic Shockwave (also shatters lasers) |
  | Gadget Gremlin | tiny, armored | Pop-Up Dome (invulnerable, reflects) |
  | Industrial Menace | huge, slow, 160 HP | Ground Pound |

- **Arena mode** vs. the Arachnotron, with 5 challenges: Standard, Glass Cannon, Beat the Clock, Enraged Arachnotron, Factory Settings.
- **Character Lab:** a passive, regenerating training dummy, a spec sheet with the live loadout, lab prompt chips, and a "take this build to the arena" button.
- **Mutation roulette:** a slot-machine reveal of a curated, supported prompt, which then goes through the normal mutation pipeline.
- **Mutation components:** rocket boosters (1–6), chain hammer (optional rocket assist), spring boxing glove (optional rocket assist), energy shield, spring legs, armor plating.
- **Three.js Mutation Chamber:** a 3D cinematic of the validated plan, with the real executor running at its climax (see below).
- **AI Director** with three personalities: Tactical Analyst, Engineering Inspector, Chaos Commentator.
- **Victory card** and fast rematch: **R** rematch, **B** rematch with build, **Esc** fighters.

## Quick start

```bash
npm install
cp .env.example .env          # optional: add ANTHROPIC_API_KEY for live AI
npm run dev                   # client on :5173 (proxies /api) + server on :8787
```

Open http://localhost:5173.

**No API key? It still plays.** Without credentials (or when a model call fails, times out, or returns invalid output) the server uses a deterministic keyword compiler and a rule-based director (`shared/fallback.ts`). If the browser can't reach the server at all, it runs the same fallback in-page. The HUD shows which path was used: `SONNET`, `FALLBACK` or `CONSOLE` on each timeline card, and `OPUS · LIVE` or `LOCAL FALLBACK` on the director ticker.

The `LINK:` line under the logo reports the server's *verified* state. At startup the server makes a no-token authenticated call (`models.retrieve`) and then updates the state after every AI request:

| Shown | Meaning |
|---|---|
| `LIVE AI · <models>` | an authenticated API call has succeeded |
| `VERIFYING API KEY…` | key present, startup check still running |
| `NO API KEY · LOCAL FALLBACK` | no key configured |
| `AUTH FAILED (HTTP 401) · LOCAL FALLBACK` | key rejected (401/403) |
| `AI ERROR · LOCAL FALLBACK` | last call failed for another reason (timeout, 5xx, invalid output) |
| `SERVER OFFLINE · IN-BROWSER FALLBACK` | the browser can't reach `/api` |

### Production

```bash
npm run build                 # typecheck + vite build -> dist/
PORT=8080 npm start           # Express serves dist/ and /api on one port
```

Deploy anywhere that runs Node 20+ (Render, Railway, Fly.io, a VM): build command `npm install && npm run build`, start command `npm start`, and set `ANTHROPIC_API_KEY` as a secret env var. The key is only ever read server-side and is never sent to the browser.

## Controls

| Input | Action |
|---|---|
| A / D | move |
| W | jump (springs boost it) |
| SPACE / SHIFT | rocket thrust (with boosters) |
| Mouse | aim arm / whirl the chain hammer |
| Left click | punch |
| Q / Right click | **hammer slam** (with chain weapon), the arena-shaking set piece |
| F (or E) | character special |
| Enter | focus the prompt console · Esc to leave |
| Esc (in game) | back to fighter select |
| L | toggle reduced effects |
| B (on result card) | rematch keeping your build |
| R | restart after a win or loss |

Demo prompts (also one-click chips under the console):
- `Give my goblin giant rocket boosters`
- `Attach a massive chain hammer to my right arm`
- `Give me a shield`
- `Make my weapon heavier`

Manual console commands go through the **same** action handlers as LLM plans:
`/attach shield size=2 color=red`, `/modify chain_weapon mass=2`, `/remove rocket_booster`.

## Imported-character abilities (models pending)

`src/game/abilities.ts` implements abilities for two imported characters. They are registered against the stable ids `kratos` and `doraemon` in `IMPORTED` (`characters.ts`) and are independent of any model files.

**The models are not in the repo yet.** Until they are, these characters use a clearly labelled neutral **prototype rig** and appear only in the select screen's **Prototype Bay**, not in the main roster. All abilities use the existing Matter world, damage and impact paths, and effects. They are bounded and clean up after themselves.

| Key | Kratos | Doraemon |
|---|---|---|
| **1 / F** | **Leviathan Axe:** a sensor projectile that damages on collision with knockback, lodges in walls and platforms, then recalls along an arc and can hit again on the way back. Only one axe at a time, with a 3.2 s hard lifetime cap. | **Air Cannon:** a compressed-air blast with large knockback and light damage. At most 3 in flight. |
| **2** | **Spartan Rage:** 6 s. Enters with a ground slam; punches become shockwave hits; 1.4× damage dealt, half damage taken, 1.25× speed. Everything is restored exactly on expiry. | **Bamboo Copter:** up to 5 s of controlled hover (hold W or Space to climb), then a capped safe-landing fall. Stops on defeat. |
| **3** | – | **Anywhere Door:** door opens, the fighter is hidden and frozen, the real physics bodies (including equipped weapons) are teleported to a validated safe spot, then the door closes. The spot is on a platform, in bounds, not under a catwalk, clear of bodies and away from the spider. Unsafe use (mid-air, or no valid exit) is rejected without charging the cooldown. |

The HUD ability strip shows clickable buttons with cooldowns and active states (axe in flight, rage running, copter battery). Mutations still work on these characters. Hulk has no abilities yet.

## Three.js Mutation Chamber

`src/chamber/Chamber.ts` is lazy-loaded (a separate ~146 KB gzipped chunk) the first time a mutation plays. Once a plan has been validated, the sequence is:

1. Phaser's game loop **sleeps**, so only one renderer draws.
2. A procedural 3D scene plays: a metallic holographic core, rings and particles, and parts built from the plan (booster racks honour `count`, hammer, glove, shield, springs, armor) flying in and snapping together.
3. The **real executor** (the shared `dispatch`) runs at the climax. Each plan row shows the actual `✓ MOUNTED` or `✗ FAULT` result, and the ignition only fires if something actually mounted.
4. A radial portal reveals the arena, which has already woken up behind it.
5. Teardown disposes all geometries, materials, textures, the PMREM environment and the renderer (`forceContextLoss`), and removes event listeners.

Click or Esc skips the animation but still applies the plan for real.

**Disabling it:** the `3D` button toggles it (the setting persists). It is always off in reduced-effects mode. If WebGL or three.js fails before execution, the original 2D cinematic plays instead (verified by simulating a WebGL failure).

## Performance (integrated GPUs)

- Physics runs at a fixed 60 Hz step with catch-up, so game speed stays correct at 30–45 FPS. Logic runs per step; visuals update per frame.
- Static vector layers are baked into textures once. Full-screen flash and alarm quads are hidden when idle. Particles, debris and bodies are capped.
- **Reduced effects** (`FX` button or **L**; switches on automatically if the frame rate stays below ~40 FPS for 3 s) does the following:
  - fewer particles and debris
  - lower solver iterations
  - ambient glows off
  - CSS scanlines and vignette off
  - 3D chamber off

  Cinematic zoom, letterbox, blueprint and explosions are kept.
- Open **`/?perf`** for an overlay showing FPS, worst frame, update/render ms, bodies, particles and FX mode. Use it to profile on the target laptop.

## How the AI is wired

```
player prompt ──► POST /api/mutate ──► Sonnet (structured JSON output, schema = MUTATION_JSON_SCHEMA)
                                         │  fail / no key / invalid
                                         ▼
                                   fallbackCompile()
          Zod MutationPlanSchema (clamps numbers, snaps illegal sockets, rejects unknown components)
                                         ▼
     browser re-validates ─► cinematic ─► dispatch(op) ─► handler registry ─► Goblin.attach/modify/remove

combat events ─► every ~12-16 s, non-blocking ─► POST /api/director ─► Opus ─► {commentary, action, intensity}
                                                                     └► fallbackDirect() on failure
```

- **Mutation compiler:** `MUTATION_MODEL`, default `claude-sonnet-5-5`. It can only pick from 6 components (`rocket_booster`, `chain_weapon`, `shield`, `spring_legs`, `armor_plating`, `boxing_glove`), 5 sockets, 3 ops (`attach`, `modify`, `remove`), bounded numeric params (`size`, `power`, `mass`, `length`, `count` 1–6, `rocket` 0–3) and a fixed colour palette. It never produces code.
- **Director:** `DIRECTOR_MODEL`, default `claude-opus-5-5`. It picks one of 8 actions: laser barrage, leap slam, enemy shield, enrage, crane drop, steam vent, crate rain, or none. It speaks in the selected personality and must reference real events. In the lab, the scene only executes arena events. The fallback builds its commentary deterministically from the latest real event. Calls are asynchronous; the game never waits on them, and a server-side lock prevents overlapping calls.
- Both calls use `output_config.format` JSON-schema structured outputs at `effort: "low"`, with a 20–25 s timeout. Every response is re-validated with Zod before it touches the game.

## Project layout

```
shared/mutations.ts   component library, sockets, bounds, Zod + JSON schemas (shared by client and server)
shared/fallback.ts    deterministic compiler + director
server/index.ts       Express API + Anthropic calls + static hosting
src/main.ts           Phaser boot + DOM HUD wiring
src/api.ts            fetch wrappers (never throw; fall back locally)
src/game/ArenaScene.ts  game loop, collisions, mutation cinematic, impacts, director actions
src/game/Goblin.ts    self-righting active ragdoll (parameterised by CharacterDef) + component builders
src/game/characters.ts  4 character definitions, their procedural textures, portrait composer
src/game/challenges.ts  challenge presets
src/game/quality.ts   reduced-effects mode + 3D chamber preference
src/chamber/Chamber.ts  Three.js Mutation Chamber (lazy-loaded)
src/menu.ts           select screen, lab panel, roulette, personalities, victory card
src/perf.ts           ?perf overlay
src/game/Spider.ts    spider body, procedural 2-bone IK legs, attack loop
src/game/Arena.ts     layered industrial arena, lamps, vents, crane, crates
src/game/Fx.ts        particles, shockwaves, flashes, debris, floating text
src/game/actions.ts   shared action registry + console command parser
src/game/textures.ts  all art, generated procedurally at boot
```

## Credits / reuse

- **Phaser 4** (MIT) with its bundled **Matter.js** (MIT): rendering, physics, constraints, particles.
- **three.js** (MIT): Mutation Chamber, procedural geometry only, plus its bundled `RoomEnvironment` for reflections.
- All four characters are original procedural designs, not based on any existing franchise.
- Action-dispatch pattern (named handler registry shared by natural-language and typed commands) adapted from [tomicz/llm-game-engine](https://github.com/tomicz/llm-game-engine) (Apache-2.0, Go). The architecture was borrowed; no code was copied.
- [simondiep/ragdoll-demo-matterjs](https://github.com/simondiep/ragdoll-demo-matterjs) was reviewed but **not used**: it has no license file, and its README notes the ragdoll is glitchy. The goblin is an original active ragdoll (PD-driven joint angles plus a hover spring) using standard Matter negative-group collision filtering.
- All graphics are procedural; there are no external art assets. Fonts: Orbitron and Share Tech Mono via Google Fonts.

## Status / known limitations

- **Verified, in headless Chromium with software WebGL (not on real GPU hardware):**
  - **Builds and servers:** typecheck, production build, dev and prod servers.
  - **Fallbacks:** every fallback path. With an invalid key the HUD shows `AUTH FAILED`; with the server offline the in-browser fallback runs.
  - **Characters:** select screen, all 4 characters spawning with correct stance, and all 4 specials dealing damage or deploying.
  - **Mutations:** six boosters, spring glove hits, rocket assist, the "most ridiculous" 3-op build, surprise rotation and roulette.
  - **Lab:** lab mode and carrying a build lab → arena.
  - **3D chamber:** full timeline with real MOUNTED results, ignition, portal, 3D off → 2D fallback, and simulated WebGL failure → 2D fallback.
  - **Director:** personalities, plus fallback lines checked against scripted combat summaries.
  - **Results flow:** challenges (clock countdown), victory card, R/B/Esc flows.
- **Not verified:**
  - **Live AI:** a successful live Sonnet/Opus round-trip. No valid API key was available.
  - **Real hardware:** frame rate on real hardware, including Intel UHD 620. Headless software rendering runs at about 5–12 FPS, so absolute FPS numbers from this environment are meaningless. JS update and render cost measured 1–7 ms per frame. Use `/?perf` on the target machine.
- The enemy AI is intentionally simple. Destruction is scripted, not simulated.
