import { create } from "zustand";
import { explainError } from "@/core/db/errors";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  copy?: string; // full text to copy (errors carry diagnostics)
}

/** A captured write event — successes and failures — so the owner can review
 *  what happened and copy exact diagnostics back for support. Never persisted
 *  to the server; lives only in memory for the session. */
export interface DiagEntry {
  id: string;
  at: string;        // ISO timestamp
  kind: "success" | "error";
  context: string;   // e.g. "Add expense"
  message: string;   // friendly summary
  raw?: string;      // raw DB message (errors)
  code?: string;     // SQLSTATE / PostgREST code (errors)
}

interface UIState {
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
  diagnostics: DiagEntry[];
  /** Toast + log a success with what changed. */
  reportSuccess: (context: string, message: string) => void;
  /** Toast (friendly + raw + code) + log a failure for copy-back. */
  reportError: (context: string, err: unknown) => void;
  clearDiagnostics: () => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const MAX_DIAG = 50;
const now = () => new Date().toISOString();

export const useUI = create<UIState>((set) => ({
  toasts: [],
  toast: (message, kind = "success") => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  diagnostics: [],
  reportSuccess: (context, message) => {
    const id = crypto.randomUUID();
    set((s) => ({
      toasts: [...s.toasts, { id, message, kind: "success" as const }],
      diagnostics: [{ id, at: now(), kind: "success" as const, context, message }, ...s.diagnostics].slice(0, MAX_DIAG),
    }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3600);
  },
  reportError: (context, err) => {
    const f = explainError(err);
    const id = crypto.randomUUID();
    const friendly = f.title === f.raw ? f.title : `${f.title} — ${f.raw}`;
    const message = f.code ? `${friendly} [${f.code}]` : friendly;
    const copy = `BostaOS diagnostic\ncontext: ${context}\ntime: ${now()}\nfriendly: ${f.title}\nraw: ${f.raw}${f.code ? `\ncode: ${f.code}` : ""}`;
    // keep the console line for deep debugging / screenshots
    console.error(`[BostaOS write] ${context}:`, err);
    set((s) => ({
      toasts: [...s.toasts, { id, message, kind: "error" as const, copy }],
      diagnostics: [{ id, at: now(), kind: "error" as const, context, message: f.title, raw: f.raw, code: f.code }, ...s.diagnostics].slice(0, MAX_DIAG),
    }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 7000);
  },
  clearDiagnostics: () => set({ diagnostics: [] }),
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
