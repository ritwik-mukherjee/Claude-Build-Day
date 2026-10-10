import { fallbackCompile, fallbackDirect } from "../shared/fallback";
import type { CombatSummary, ComponentType, DirectorResponse, LinkState, MutateResponse } from "../shared/mutations";
import { bus } from "./game/bus";

const reportLink = (state: LinkState | undefined) => state && bus.emit("link", { state });

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Never throws: falls back to the in-browser deterministic compiler if the server is unreachable. */
export async function requestMutation(prompt: string, owned: ComponentType[]): Promise<MutateResponse> {
  try {
    const r = await post<MutateResponse>("/api/mutate", { prompt, owned }, 25_000);
    reportLink(r.link);
    return r;
  } catch (e) {
    reportLink("offline");
    return { plan: fallbackCompile(prompt, owned), source: "fallback", note: `server unreachable (${(e as Error).message})` };
  }
}

export async function requestDirector(summary: CombatSummary): Promise<DirectorResponse> {
  try {
    const r = await post<DirectorResponse>("/api/director", summary, 30_000);
    reportLink(r.link);
    return r;
  } catch (e) {
    reportLink("offline");
    return { decision: fallbackDirect(summary), source: "fallback", note: `server unreachable (${(e as Error).message})` };
  }
}

export async function getStatus(): Promise<{ state: LinkState; detail?: string; mutationModel: string; directorModel: string } | null> {
  try {
    const r = await fetch("/api/status");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
