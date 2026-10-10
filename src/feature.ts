// Select-screen "Imported 3D Fighters" stage. Lazy-loads three.js + the showcase only when
// the tab is opened; the renderer is disposed whenever the menu is left.
import type { CharacterShowcase } from "./chamber/Showcase";
import type { ModelId } from "./chamber/models";

let sc: CharacterShowcase | null = null;
let opening: Promise<CharacterShowcase | null> | null = null;
/** real-model portrait renders (data URLs), reused by the feature list and victory card */
export const snapshots = new Map<string, string>();
let snapping = false;

export async function openShowcase(host: HTMLElement, low: boolean, onStatus: (id: string, s: string, msg?: string) => void) {
  if (sc) {
    sc.start();
    return sc;
  }
  opening ??= (async () => {
    try {
      const { CharacterShowcase } = await import("./chamber/Showcase");
      const s = new CharacterShowcase(host, low);
      s.onStatus = onStatus;
      s.start();
      sc = s;
      return s;
    } catch (e) {
      console.warn("[feature] 3D showcase unavailable", e);
      return null;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

export function featureShow(id: ModelId) {
  void sc?.show(id);
}

export function closeShowcase() {
  sc?.dispose();
  sc = null;
}

/** Render each model once (sequentially) for list thumbnails / victory portraits. */
export async function makeSnapshots(ids: ModelId[], onEach: (id: ModelId) => void) {
  if (snapping || !sc) return;
  snapping = true;
  try {
    for (const id of ids) {
      if (snapshots.has(id) || !sc) continue;
      try {
        snapshots.set(id, await sc.snapshot(id));
        onEach(id);
      } catch (e) {
        console.warn("[feature] snapshot failed", id, e);
      }
    }
  } finally {
    snapping = false;
  }
}

export function creditFor(id: ModelId) {
  return sc?.credit ?? id;
}
