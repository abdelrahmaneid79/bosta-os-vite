import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

interface UIState {
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  toasts: [],
  toast: (message, kind = "success") => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
