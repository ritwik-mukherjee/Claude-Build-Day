import { fallbackCompile, fallbackDirect } from "../shared/fallback";
import type { CombatSummary, ComponentType, DirectorResponse, MutateResponse } from "../shared/mutations";

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
    return await post<MutateResponse>("/api/mutate", { prompt, owned }, 25_000);
  } catch (e) {
    return { plan: fallbackCompile(prompt, owned), source: "fallback", note: `server unreachable (${(e as Error).message})` };
  }
}

export async function requestDirector(summary: CombatSummary): Promise<DirectorResponse> {
  try {
    return await post<DirectorResponse>("/api/director", summary, 30_000);
  } catch (e) {
    return { decision: fallbackDirect(summary), source: "fallback", note: `server unreachable (${(e as Error).message})` };
  }
}

export async function getStatus(): Promise<{ live: boolean; mutationModel: string; directorModel: string } | null> {
  try {
    const r = await fetch("/api/status");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
