/** Alert dismissal state — which alert keys the owner has dismissed. Persisted
 *  per-browser. An alert that stops being generated (condition resolved) is
 *  pruned from this list automatically (see prune), so dismissing never hides a
 *  future recurrence forever. */
import { create } from "zustand";

const KEY = "bostaos.alerts.dismissed.v1";
function load(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; }
  catch { return []; }
}
function save(v: string[]) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } }

interface AlertState {
  dismissed: string[];
  dismiss: (key: string) => void;
  restore: (key: string) => void;
  restoreAll: () => void;
  /** Drop dismissals whose underlying alert no longer exists (auto-resolved). */
  prune: (staleKeys: string[]) => void;
}

export const useAlertDismissals = create<AlertState>((set) => ({
  dismissed: load(),
  dismiss: (key) => set((s) => { const d = [...new Set([...s.dismissed, key])]; save(d); return { dismissed: d }; }),
  restore: (key) => set((s) => { const d = s.dismissed.filter((x) => x !== key); save(d); return { dismissed: d }; }),
  restoreAll: () => { save([]); set({ dismissed: [] }); },
  prune: (staleKeys) => set((s) => {
    if (!staleKeys.length) return s;
    const set2 = new Set(staleKeys);
    const d = s.dismissed.filter((x) => !set2.has(x));
    if (d.length === s.dismissed.length) return s;
    save(d); return { dismissed: d };
  }),
}));
