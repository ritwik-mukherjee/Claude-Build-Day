# RAGDOLL.AI

Prompt-driven 2D physics combat. You pilot a mechanical goblin ragdoll in an industrial arena against a mechanical spider. Type what you want ("give my goblin giant rocket boosters") and an LLM compiles it into a **validated mutation plan** built from a fixed library of physical components. The plan then plays as a cinematic: a schematic appears, parts fly in and bolt on, and the boosters ignite. A second model acts as the **AI Director**: it watches combat summaries and triggers countermeasures and arena events.

Stack: TypeScript · Phaser 4 (Matter.js physics) · Vite · Node/Express · Anthropic SDK · Zod.

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
| Enter | focus the prompt console · Esc to leave |
| R | restart after a win or loss |

Demo prompts (also one-click chips under the console):
- `Give my goblin giant rocket boosters`
- `Attach a massive chain hammer to my right arm`
- `Give me a shield`
- `Make my weapon heavier`

Manual console commands go through the **same** action handlers as LLM plans:
`/attach shield size=2 color=red`, `/modify chain_weapon mass=2`, `/remove rocket_booster`.

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

- **Mutation compiler:** `MUTATION_MODEL`, default `claude-sonnet-5-5`. It can only pick from 5 components (`rocket_booster`, `chain_weapon`, `shield`, `spring_legs`, `armor_plating`), 5 sockets, 3 ops (`attach`, `modify`, `remove`), bounded numeric params (`size`, `power`, `mass`, `length`) and a fixed colour palette. It never produces code.
- **Director:** `DIRECTOR_MODEL`, default `claude-opus-5-5`. It picks one of 8 actions: laser barrage, leap slam, enemy shield, enrage, crane drop, steam vent, crate rain, or none. Calls are asynchronous; the game never waits on them, and a server-side lock prevents overlapping calls.
- Both calls use `output_config.format` JSON-schema structured outputs at `effort: "low"`, with a 20–25 s timeout. Every response is re-validated with Zod before it touches the game.

## Project layout

```
shared/mutations.ts   component library, sockets, bounds, Zod + JSON schemas (shared by client and server)
shared/fallback.ts    deterministic compiler + director
server/index.ts       Express API + Anthropic calls + static hosting
src/main.ts           Phaser boot + DOM HUD wiring
src/api.ts            fetch wrappers (never throw; fall back locally)
src/game/ArenaScene.ts  game loop, collisions, mutation cinematic, impacts, director actions
src/game/Goblin.ts    self-righting active ragdoll + component builders
src/game/Spider.ts    spider body, procedural 2-bone IK legs, attack loop
src/game/Arena.ts     layered industrial arena, lamps, vents, crane, crates
src/game/Fx.ts        particles, shockwaves, flashes, debris, floating text
src/game/actions.ts   shared action registry + console command parser
src/game/textures.ts  all art, generated procedurally at boot
```

## Credits / reuse

- **Phaser 4** (MIT) with its bundled **Matter.js** (MIT): rendering, physics, constraints, particles.
- Action-dispatch pattern (named handler registry shared by natural-language and typed commands) adapted from [tomicz/llm-game-engine](https://github.com/tomicz/llm-game-engine) (Apache-2.0, Go). The architecture was borrowed; no code was copied.
- [simondiep/ragdoll-demo-matterjs](https://github.com/simondiep/ragdoll-demo-matterjs) was reviewed but **not used**: it has no license file, and its README notes the ragdoll is glitchy. The goblin is an original active ragdoll (PD-driven joint angles plus a hover spring) using standard Matter negative-group collision filtering.
- All graphics are procedural; there are no external art assets. Fonts: Orbitron and Share Tech Mono via Google Fonts.

## Status / known limitations

- **Verified:** typecheck, production build, dev and prod servers, every fallback endpoint, and an invalid-key request that reaches the Anthropic API, gets a 401, shows `AUTH FAILED` in the HUD, and degrades cleanly to the fallback. Browser-tested in headless Chromium only, not on a real GPU: rockets (cinematic plus thrust flight), chain hammer (whirl, slam, damage), shield (blocks and reflects lasers), modify (heavier weapon), rejected invalid command, director events, victory screen, R restart, and offline in-browser fallback.
- **Not verified:** a successful live Sonnet/Opus round-trip. No valid key was available during the build, so whether the API accepts the exact structured-output request has not been confirmed.
- Headless software rendering runs at about 10–30 FPS, so cinematic timing there is slower than on a real GPU. Physics is frame-stepped.
- The enemy AI is intentionally simple. Destruction is scripted (debris, scorch marks, shoves, ceiling rain), not simulated fracture.
