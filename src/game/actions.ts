// Structured action dispatch (pattern borrowed from tomicz/llm-game-engine, Apache-2.0):
// LLM output and typed console commands both become validated Operations and go
// through the same named handler registry. Unknown / invalid actions fail safely.
import { z } from "zod";
import { COMPONENTS, MutationPlanSchema, OperationSchema, type MutationPlan, type Operation } from "../../shared/mutations";

export type Handler = (op: Operation) => void | Promise<void>;
const handlers = new Map<Operation["op"], Handler>();

export function registerHandler(name: Operation["op"], h: Handler) {
  handlers.set(name, h);
}

export async function dispatch(op: Operation): Promise<{ ok: boolean; error?: string }> {
  const h = handlers.get(op.op);
  if (!h) return { ok: false, error: `no handler for "${op.op}"` };
  try {
    await h(op);
    return { ok: true };
  } catch (e) {
    console.error("[dispatch]", op, e);
    return { ok: false, error: (e as Error).message };
  }
}

/** Validate untrusted plan JSON (from server or anywhere else). */
export function validatePlan(raw: unknown): { plan?: MutationPlan; error?: string } {
  const r = MutationPlanSchema.safeParse(raw);
  return r.success ? { plan: r.data } : { error: z.prettifyError(r.error) };
}

/**
 * Console commands bypass the LLM but use the same handlers:
 *   /attach shield [size=2 power=2 color=red socket=left_hand]
 *   /modify chain_weapon mass=2
 *   /remove rocket_booster
 */
export function parseCommand(input: string): { plan?: MutationPlan; error?: string } | null {
  if (!input.startsWith("/")) return null;
  const [cmd, comp, ...rest] = input.slice(1).trim().split(/\s+/);
  if (!["attach", "modify", "remove"].includes(cmd)) return { error: `unknown command /${cmd}. Try /attach, /modify, /remove` };
  if (!comp || !(COMPONENTS as readonly string[]).includes(comp)) return { error: `component must be one of: ${COMPONENTS.join(", ")}` };
  const isMod = cmd === "modify";
  const raw: Record<string, unknown> = {
    op: cmd,
    component: comp,
    socket: "right_hand",
    size: isMod ? 1 : 1.5,
    power: isMod ? 1 : 1.5,
    mass: isMod ? 1 : 1.5,
    length: isMod ? 1 : 1.4,
    color: "orange",
  };
  for (const kv of rest) {
    const [k, v] = kv.split("=");
    if (!k || v === undefined) continue;
    raw[k] = Number.isFinite(Number(v)) ? Number(v) : v;
  }
  const op = OperationSchema.safeParse(raw);
  if (!op.success) return { error: z.prettifyError(op.error) };
  return validatePlan({ summary: `Manual override: ${cmd} ${comp}`, operations: [raw] });
}
