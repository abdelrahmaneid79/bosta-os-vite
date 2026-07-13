/** Automatic daily-close detection + lifecycle — PURE Layer 2 (Cycle 9).
 *
 *  Replaces owner-attested booleans with DERIVED facts wherever BostaOS can
 *  read the truth from records. The owner only attests to what genuinely
 *  cannot be derived: "the store did not trade", "no expenses today", "no
 *  purchase today", "cash count intentionally skipped".
 *
 *  Nothing is fabricated to close a day. A day with missing sales cannot be
 *  auto-completed; it can only be saved partial, or confirmed no-trading by
 *  the owner. The lifecycle (version / stale detection / reopen) makes a close
 *  an auditable record, not a boolean. */

const r1 = (n: number) => Math.round(n * 10) / 10;

export type CloseStatus =
  | "open"        // no close saved for this date
  | "ready"       // everything derivable is satisfied — safe to complete
  | "complete"
  | "partial"
  | "estimated"
  | "no_trading"
  | "reopened";

export type CloseItemKind =
  | "auto"        // BostaOS derived it — no owner action
  | "confirm"     // owner must attest (cannot be derived)
  | "blocked"     // prevents completion until fixed
  | "optional"    // nice-to-have; never blocks
  | "unresolved"; // a real data-integrity exception; blocks completion

export interface CloseItem {
  key: string;
  label: string;
  kind: CloseItemKind;
  ok: boolean;         // satisfied
  required: boolean;   // counts toward the completeness denominator
  detail: string;
}

/** Everything BostaOS can DERIVE about a date from records. Booleans here are
 *  facts, not owner opinions. */
export interface DailyCloseFacts {
  date: string;
  /** sales */
  salesRecorded: boolean;
  salesVerification: "verified" | "partially_verified" | "unverified" | "estimated" | "none";
  productLinesPresent: boolean;
  productLinesReconcile: boolean | null;   // null when there are no lines to reconcile
  markedNoTrading: boolean;                // an explicit no-trading record exists
  /** expenses / purchases */
  expensesRecorded: boolean;
  purchasesRecorded: boolean;
  /** data hygiene */
  importsAwaitingApproval: number;
  unmappedLines: number;
  missingCogsLines: number;
  /** cash */
  cashCountRequired: boolean;              // policy: does this date require a count?
  cashCountRecorded: boolean;
  cashDifferenceUnresolved: boolean;
  /** cheque */
  chequeNeedsUpdate: boolean;
  /** inventory / actions */
  inventoryAlertsToAck: number;
  criticalActionsOpen: number;
}

/** Owner attestations for facts BostaOS cannot derive. */
export interface CloseConfirmations {
  noTrading?: boolean;
  expensesNone?: boolean;
  purchasesNone?: boolean;
  cashSkip?: { reason: string } | null;
}

export interface CloseEvaluation {
  date: string;
  items: CloseItem[];
  autoComplete: CloseItem[];
  confirmRequired: CloseItem[];
  blocked: CloseItem[];
  optional: CloseItem[];
  unresolved: CloseItem[];
  completeness: number;          // 0–100 over required + relevant items
  confidence: "high" | "medium" | "low";
  recommendedStatus: CloseStatus;
  canComplete: boolean;
  blockReason: string | null;
  nextAction: string | null;
}

/** Derive the full close evaluation from facts + the owner's attestations. */
export function detectCloseState(f: DailyCloseFacts, c: CloseConfirmations = {}): CloseEvaluation {
  // ── no-trading short-circuit ───────────────────────────────────────────
  if (f.markedNoTrading || c.noTrading) {
    const item: CloseItem = { key: "no_trading", label: "Store did not trade", kind: "auto", ok: true, required: true, detail: f.markedNoTrading ? "A no-trading record exists for this day." : "Owner confirmed the store did not trade." };
    return {
      date: f.date, items: [item], autoComplete: [item], confirmRequired: [], blocked: [], optional: [], unresolved: [],
      completeness: 100, confidence: "high", recommendedStatus: "no_trading", canComplete: true, blockReason: null, nextAction: null,
    };
  }

  const items: CloseItem[] = [];

  // ── sales (required) ───────────────────────────────────────────────────
  if (f.salesRecorded) {
    items.push({ key: "sales", label: "Sales recorded", kind: "auto", ok: true, required: true, detail: `Auto-detected: a sales day exists (${f.salesVerification}).` });
  } else {
    items.push({ key: "sales", label: "Sales recorded", kind: "blocked", ok: false, required: true, detail: "No sales day on record. Enter the day's sales, or confirm the store did not trade — nothing is invented to close the day." });
  }
  // sales verification quality (only when recorded)
  if (f.salesRecorded && f.salesVerification === "estimated") {
    items.push({ key: "sales_estimated", label: "Sales are estimated", kind: "confirm", ok: false, required: false, detail: "The recorded sales are estimated — the day can close as 'estimated', not 'complete'." });
  } else if (f.salesRecorded && (f.salesVerification === "unverified" || f.salesVerification === "partially_verified")) {
    items.push({ key: "sales_unverified", label: "Confirm the sales figure", kind: "confirm", ok: false, required: false, detail: "Sales are not fully verified — review the figure before completing." });
  }

  // ── product-line reconciliation ────────────────────────────────────────
  if (f.productLinesPresent && f.productLinesReconcile === false) {
    items.push({ key: "product_lines", label: "Product lines match the day total", kind: "unresolved", ok: false, required: false, detail: "The sum of product lines differs from the day total beyond tolerance. Resolve before completing." });
  } else if (f.productLinesPresent) {
    items.push({ key: "product_lines", label: "Product lines match the day total", kind: "auto", ok: true, required: false, detail: "Auto-detected: product lines reconcile to the day total." });
  } else {
    items.push({ key: "product_lines", label: "Product-line detail", kind: "optional", ok: false, required: false, detail: "No product-line breakdown for this day (optional — day total still counts)." });
  }

  // ── expenses (required consideration) ──────────────────────────────────
  if (f.expensesRecorded) {
    items.push({ key: "expenses", label: "Expenses entered", kind: "auto", ok: true, required: true, detail: "Auto-detected: at least one expense exists for this day." });
  } else if (c.expensesNone) {
    items.push({ key: "expenses", label: "No expenses today", kind: "confirm", ok: true, required: true, detail: "Owner confirmed no expenses occurred today." });
  } else {
    items.push({ key: "expenses", label: "Expenses entered (or none)", kind: "confirm", ok: false, required: true, detail: "No expenses on record. Enter any, or confirm none occurred today." });
  }

  // ── purchases (optional consideration) ─────────────────────────────────
  if (f.purchasesRecorded) {
    items.push({ key: "purchases", label: "Purchases entered", kind: "auto", ok: true, required: false, detail: "Auto-detected: a purchase exists for this day." });
  } else if (c.purchasesNone) {
    items.push({ key: "purchases", label: "No purchase today", kind: "confirm", ok: true, required: false, detail: "Owner confirmed no purchase was made today." });
  } else {
    items.push({ key: "purchases", label: "Purchases entered (or none)", kind: "confirm", ok: false, required: false, detail: "No purchase on record. Enter any, or confirm none occurred today." });
  }

  // ── imports awaiting approval (blocks) ─────────────────────────────────
  if (f.importsAwaitingApproval > 0) {
    items.push({ key: "imports", label: "Imports awaiting approval", kind: "blocked", ok: false, required: false, detail: `${f.importsAwaitingApproval} import(s) await approval — approve or discard before completing.` });
  }

  // ── unmapped sale lines (blocks) ───────────────────────────────────────
  if (f.unmappedLines > 0) {
    items.push({ key: "unmapped", label: "Unmapped sale lines", kind: "unresolved", ok: false, required: false, detail: `${f.unmappedLines} sale line(s) not linked to a product — map them so product reports stay correct.` });
  }

  // ── missing COGS (optional) ────────────────────────────────────────────
  if (f.missingCogsLines > 0) {
    items.push({ key: "cogs", label: "Some sold lines lack cost", kind: "optional", ok: false, required: false, detail: `${f.missingCogsLines} sold line(s) have no cost — profit is withheld, but the day can still close.` });
  }

  // ── cash count (policy-driven, required when policy says so) ───────────
  if (!f.cashCountRequired) {
    items.push({ key: "cash_count", label: "Cash count not required today", kind: "auto", ok: true, required: false, detail: "Policy does not require a cash count for this day." });
  } else if (f.cashCountRecorded) {
    items.push({ key: "cash_count", label: "Cash counted", kind: "auto", ok: true, required: true, detail: "Auto-detected: a cash count exists for this day." });
  } else if (c.cashSkip) {
    items.push({ key: "cash_count", label: "Cash count skipped", kind: "confirm", ok: true, required: true, detail: `Owner skipped the count — reason: ${c.cashSkip.reason}` });
  } else {
    items.push({ key: "cash_count", label: "Cash counted (policy requires it)", kind: "confirm", ok: false, required: true, detail: "Policy requires a count today. Count the drawer, or record an explicit skip reason." });
  }

  // ── unresolved cash difference (blocks) ────────────────────────────────
  if (f.cashDifferenceUnresolved) {
    items.push({ key: "cash_diff", label: "Unresolved cash difference", kind: "unresolved", ok: false, required: false, detail: "A cash difference is open. Investigate or record it before completing — it is never silently cleared." });
  }

  // ── cheque (confirm, never blocks) ─────────────────────────────────────
  if (f.chequeNeedsUpdate) {
    items.push({ key: "cheque", label: "Cheque position may need updating", kind: "confirm", ok: false, required: false, detail: "The cheque state looks like it changed — confirm the latest settlement is recorded." });
  }

  // ── inventory alerts (optional) ────────────────────────────────────────
  if (f.inventoryAlertsToAck > 0) {
    items.push({ key: "inventory", label: "Inventory alerts to review", kind: "optional", ok: false, required: false, detail: `${f.inventoryAlertsToAck} inventory alert(s) to acknowledge (does not block the close).` });
  }

  // ── critical actions (optional surfacing) ──────────────────────────────
  if (f.criticalActionsOpen > 0) {
    items.push({ key: "actions", label: "Open critical actions", kind: "optional", ok: false, required: false, detail: `${f.criticalActionsOpen} critical action(s) still open.` });
  }

  const autoComplete = items.filter((i) => i.kind === "auto" && i.ok);
  const confirmRequired = items.filter((i) => i.kind === "confirm" && !i.ok);
  const blocked = items.filter((i) => i.kind === "blocked");
  const optional = items.filter((i) => i.kind === "optional");
  const unresolved = items.filter((i) => i.kind === "unresolved");

  // completeness — over required + auto/confirm items (data-integrity blockers count against)
  const relevant = items.filter((i) => i.required || i.kind === "auto" || i.kind === "confirm" || i.kind === "unresolved" || i.kind === "blocked");
  const okCount = relevant.filter((i) => i.ok).length;
  const completeness = relevant.length ? r1((okCount / relevant.length) * 100) : 100;

  const requiredMissing = items.filter((i) => i.required && !i.ok);
  const hasBlocker = blocked.length > 0 || unresolved.length > 0;
  const canComplete = requiredMissing.length === 0 && !hasBlocker;

  let recommendedStatus: CloseStatus;
  if (!canComplete) recommendedStatus = "partial";
  else if (f.salesVerification === "estimated") recommendedStatus = "estimated";
  else recommendedStatus = "ready";   // everything derivable satisfied — owner completes

  // confidence
  let confidence: CloseEvaluation["confidence"];
  if (unresolved.length || blocked.length || f.salesVerification === "unverified") confidence = "low";
  else if (confirmRequired.length || f.salesVerification !== "verified" || optional.some((o) => o.key === "cogs")) confidence = "medium";
  else confidence = "high";

  const firstBlock = [...blocked, ...unresolved, ...requiredMissing][0] ?? null;
  const blockReason = canComplete ? null
    : `Cannot mark complete — ${[...blocked, ...unresolved, ...requiredMissing].map((i) => i.label).join("; ")}. Nothing is fabricated to close the day.`;

  return {
    date: f.date, items,
    autoComplete, confirmRequired, blocked, optional, unresolved,
    completeness, confidence, recommendedStatus, canComplete, blockReason,
    nextAction: firstBlock ? firstBlock.detail : (confirmRequired[0]?.detail ?? null),
  };
}

/* ── lifecycle / state machine ────────────────────────────────────────── */

export interface CloseRecordState {
  status: CloseStatus;
  version: number;
  /** the newest updated_at across the day's underlying records when it was closed */
  sourceDataAt: string | null;
  voided: boolean;
}

/** A completed close goes stale when an underlying record changed after it was
 *  closed. Deterministic: newest source timestamp is strictly after the close's
 *  captured source timestamp. */
export function closeIsStale(rec: CloseRecordState, currentSourceDataAt: string | null): { stale: boolean; reason: string | null } {
  if (rec.voided) return { stale: false, reason: null };
  if (rec.status !== "complete" && rec.status !== "estimated" && rec.status !== "no_trading") return { stale: false, reason: null };
  if (!currentSourceDataAt || !rec.sourceDataAt) return { stale: false, reason: null };
  if (currentSourceDataAt > rec.sourceDataAt) {
    return { stale: true, reason: `A transaction for this day changed after the close (records updated ${currentSourceDataAt}, closed against ${rec.sourceDataAt}). Reopen and re-close to keep the record accurate.` };
  }
  return { stale: false, reason: null };
}

export type CloseTransition = "complete" | "reopen" | "void" | "save_partial";

/** Validate a lifecycle transition and return the next persisted state.
 *  Rules: one active close per date (enforced by the DB unique index);
 *  completing requires canComplete; reopening requires a reason; re-closing
 *  bumps the version; voiding preserves history. */
export function applyCloseTransition(
  prev: CloseRecordState | null,
  t: CloseTransition,
  ctx: { canComplete?: boolean; reason?: string; recommendedStatus?: CloseStatus; sourceDataAt?: string | null },
): { ok: true; next: CloseRecordState } | { ok: false; error: string } {
  const version = (prev?.version ?? 0);
  switch (t) {
    case "complete": {
      if (!ctx.canComplete) return { ok: false, error: "Cannot complete — required items are unmet or a blocker is open." };
      const status: CloseStatus = ctx.recommendedStatus === "estimated" ? "estimated" : "complete";
      return { ok: true, next: { status, version: version + 1, sourceDataAt: ctx.sourceDataAt ?? null, voided: false } };
    }
    case "save_partial":
      return { ok: true, next: { status: "partial", version: version + 1, sourceDataAt: ctx.sourceDataAt ?? null, voided: false } };
    case "reopen": {
      if (!prev) return { ok: false, error: "Nothing to reopen." };
      if (!ctx.reason || !ctx.reason.trim()) return { ok: false, error: "Reopening requires a reason." };
      return { ok: true, next: { status: "reopened", version: version + 1, sourceDataAt: prev.sourceDataAt, voided: false } };
    }
    case "void": {
      if (!prev) return { ok: false, error: "Nothing to void." };
      if (!ctx.reason || !ctx.reason.trim()) return { ok: false, error: "Voiding requires a reason." };
      return { ok: true, next: { status: prev.status, version: version + 1, sourceDataAt: prev.sourceDataAt, voided: true } };
    }
  }
}
