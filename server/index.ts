import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_SOCKETS,
  BOUNDS,
  COMPONENTS,
  DIRECTOR_ACTIONS,
  DIRECTOR_JSON_SCHEMA,
  DirectorDecisionSchema,
  MUTATION_JSON_SCHEMA,
  MutationPlanSchema,
  type CombatSummary,
  type ComponentType,
  type DirectorResponse,
  type MutateResponse,
} from "../shared/mutations";
import { fallbackCompile, fallbackDirect } from "../shared/fallback";

const PORT = Number(process.env.PORT ?? 8787);
const MUTATION_MODEL = process.env.MUTATION_MODEL ?? "claude-sonnet-5-5";
const DIRECTOR_MODEL = process.env.DIRECTOR_MODEL ?? "claude-opus-5-5";
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = HAS_KEY ? new Anthropic({ maxRetries: 1 }) : null;

const MUTATION_SYSTEM = `You are the MUTATION COMPILER for RAGDOLL.AI, a 2D physics combat game.
The player controls a mechanical goblin ragdoll and types requests to mutate it.
Translate the request into a mutation plan using ONLY the approved component library. You never write code.

Components (and legal sockets):
${COMPONENTS.map((c) => `- ${c}: sockets ${ALLOWED_SOCKETS[c].join(", ")}`).join("\n")}

Semantics:
- rocket_booster: thrust jets. power = thrust, size = visual scale.
- chain_weapon: flail/hammer on a physics chain. mass = head weight, length = chain length, size = head size, power = damage.
- shield: blocks lasers and debris. power = durability, size = coverage.
- spring_legs: jump boost. power = jump strength.
- armor_plating: reduces damage taken. power = damage reduction.
Bounds: size ${BOUNDS.size.join("-")}, power ${BOUNDS.power.join("-")}, mass ${BOUNDS.mass.join("-")}, length ${BOUNDS.length.join("-")}.
op "attach" adds/replaces a component with absolute values. op "modify" multiplies an EXISTING component's values (1 = unchanged), e.g. "heavier weapon" -> modify chain_weapon mass 2, others 1.
op "remove" detaches a component (numbers ignored, use 1).
Map vague weapons (hammer, mace, wrecking ball, flail, sword) to chain_weapon. Map flying/jets to rocket_booster.
If the request is impossible or off-topic, pick the closest fun component anyway. Max 3 operations.
Summary: one punchy sentence describing the result, in-world.`;

const DIRECTOR_SYSTEM = `You are the AI DIRECTOR of RAGDOLL.AI, an industrial gladiator arena where a mechanical goblin fights a mechanical spider.
You receive a combat summary. Choose ONE countermeasure or arena event that keeps the fight dramatic and fair:
${DIRECTOR_ACTIONS.join(", ")}.
Counter the player's current build (e.g. lasers vs. airborne rocket users, enemy_shield_up vs. heavy flails, leap slam vs. shield turtling).
If the player is losing badly, ease off (none or a mild arena event). intensity 1-3.
commentary: a short sardonic arena-announcer line (< 100 chars) explaining the move.`;

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callStructured(model: string, system: string, user: string, schema: object, timeoutMs: number) {
  const msg = await client!.messages.create(
    {
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
    },
    { timeout: timeoutMs },
  );
  if (msg.stop_reason === "refusal") throw new Error("model refused");
  return JSON.parse(textOf(msg));
}

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/api/status", (_req, res) => {
  res.json({ live: HAS_KEY, mutationModel: MUTATION_MODEL, directorModel: DIRECTOR_MODEL });
});

app.post("/api/mutate", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").slice(0, 300).trim();
  const owned = (Array.isArray(req.body?.owned) ? req.body.owned : []).filter((c: unknown): c is ComponentType =>
    (COMPONENTS as readonly string[]).includes(String(c)),
  );
  if (!prompt) return void res.status(400).json({ error: "empty prompt" });

  let out: MutateResponse;
  if (!client) {
    out = { plan: fallbackCompile(prompt, owned), source: "fallback", note: "no API key configured" };
  } else {
    try {
      const raw = await callStructured(
        MUTATION_MODEL,
        MUTATION_SYSTEM,
        `Currently equipped: ${owned.length ? owned.join(", ") : "nothing"}.\nPlayer request: """${prompt}"""`,
        MUTATION_JSON_SCHEMA,
        20_000,
      );
      out = { plan: MutationPlanSchema.parse(raw), source: "sonnet" };
    } catch (err) {
      console.warn("[mutate] model failed, using fallback:", (err as Error).message);
      out = { plan: fallbackCompile(prompt, owned), source: "fallback", note: (err as Error).message.slice(0, 120) };
    }
  }
  console.log(`[mutate] (${out.source}) "${prompt}" ->`, JSON.stringify(out.plan));
  res.json(out);
});

let directorBusy = false;
app.post("/api/director", async (req, res) => {
  const s = req.body as CombatSummary;
  const summary: CombatSummary = {
    elapsed: Number(s?.elapsed) || 0,
    playerHp: Number(s?.playerHp) || 0,
    enemyHp: Number(s?.enemyHp) || 0,
    round: Number(s?.round) || 0,
    playerComponents: (Array.isArray(s?.playerComponents) ? s.playerComponents : []).map(String).slice(0, 8),
    events: (Array.isArray(s?.events) ? s.events : []).map((e) => String(e).slice(0, 80)).slice(-12),
  };
  let out: DirectorResponse;
  if (!client || directorBusy) {
    out = { decision: fallbackDirect(summary), source: "fallback", note: client ? "director busy" : "no API key configured" };
  } else {
    directorBusy = true;
    try {
      const raw = await callStructured(DIRECTOR_MODEL, DIRECTOR_SYSTEM, JSON.stringify(summary), DIRECTOR_JSON_SCHEMA, 25_000);
      out = { decision: DirectorDecisionSchema.parse(raw), source: "opus" };
    } catch (err) {
      console.warn("[director] model failed, using fallback:", (err as Error).message);
      out = { decision: fallbackDirect(summary), source: "fallback", note: (err as Error).message.slice(0, 120) };
    } finally {
      directorBusy = false;
    }
  }
  console.log(`[director] (${out.source})`, JSON.stringify(out.decision));
  res.json(out);
});

// Production: serve the built client from the same origin.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(PORT, () => {
  console.log(`RAGDOLL.AI server on :${PORT}  live AI: ${HAS_KEY ? `yes (${MUTATION_MODEL} / ${DIRECTOR_MODEL})` : "no (deterministic fallback)"}`);
});
