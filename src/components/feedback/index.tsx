import type { ReactNode } from "react";
import { useUI } from "@/store/ui";
import { cn } from "@/core/utils/cn";

export function Toaster() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-[92vw] animate-toastIn items-start gap-2.5 rounded-xl border border-line bg-panel2 px-5 py-3 font-display text-sm font-medium text-text shadow-sheet"
        >
          <span
            className={cn(
              "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
              t.kind === "success" && "bg-good",
              t.kind === "error" && "bg-bad",
              t.kind === "info" && "bg-pink",
            )}
          />
          <span onClick={() => dismiss(t.id)} className="cursor-pointer break-words">{t.message}</span>
          {t.kind === "error" && (
            <button
              onClick={() => navigator.clipboard?.writeText(t.copy ?? t.message)}
              className="ml-1 flex-shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-dim hover:text-text"
              title="Copy diagnostics"
            >
              Copy
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title, hint, icon, action,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-14 text-center">
      {icon && <div className="mb-3 text-pink">{icon}</div>}
      <div className="font-display text-base font-semibold text-text">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-sm text-dim">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-md bg-line2", className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="panel divide-y divide-line2 overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="flex-1">
            <Skeleton className="mb-2 h-2.5 w-20" />
            <Skeleton className="h-2 w-12" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-bad/40 bg-bad/5 p-6 text-center">
      <div className="font-display font-semibold text-bad">Something went wrong</div>
      <div className="mt-1 text-sm text-muted">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm text-text hover:bg-line2">
          Retry
        </button>
      )}
    </div>
  );
}
