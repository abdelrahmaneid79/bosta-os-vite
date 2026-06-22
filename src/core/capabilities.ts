/**
 * Capability system — the single source of truth for what the app can write.
 * Replaces the blunt global "read-only" flag. Each action is one of:
 *   - "enabled"   → fully implemented + safe; button works
 *   - "risky"     → works but needs a confirmation (financial reversal etc.)
 *   - "not-built" → no working flow yet; show "Coming soon", keep gated
 *
 * UI reads these; nothing else decides whether a write is allowed.
 */
export type Capability = "enabled" | "risky" | "not-built";

export const CAP = {
  // Phase 1 — Goods + Purchases
  productCreate: "enabled",
  productEdit: "enabled",
  productActive: "enabled",
  aliasAdd: "enabled",
  purchaseCreate: "enabled",
  // Phase 2 — Sales
  saleCreate: "enabled",
  saleItemAdd: "enabled",
  saleItemEdit: "risky",   // reverses + reapplies inventory movement
  saleItemVoid: "risky",   // restores stock
  saleVoid: "risky",       // voids the whole day + its movements
  // Phase 3 — Expenses + Cash
  expenseCreate: "enabled",
  expenseVoid: "risky",
  cashMovement: "enabled",
  cashCount: "enabled",
  withdrawal: "enabled",
  movementVoid: "risky",
  // Phase 4 — Cheques / Settlements
  chequeRecord: "enabled",
  chequeReconcile: "risky",
  chequeVoid: "risky",
  settlementOpen: "enabled",
  // Phase 7 — Settings
  settingsEdit: "enabled",
  // Phase 6 — Imports (CSV preview → approve)
  importApprove: "enabled",
} as const satisfies Record<string, Capability>;

export type CapKey = keyof typeof CAP;
export const cap = (k: CapKey): Capability => CAP[k];
export const isEnabled = (k: CapKey): boolean => (CAP[k] as Capability) !== "not-built";

/** Human label for the header/system badges. */
export const WRITE_BADGE = "Fully operational";
