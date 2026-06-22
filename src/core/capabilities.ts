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
  // Later phases — not wired yet
  expenseCreate: "not-built",
  cashCount: "not-built",
  chequeRecord: "not-built",
  importApprove: "not-built",
  settingsEdit: "not-built",
} as const satisfies Record<string, Capability>;

export type CapKey = keyof typeof CAP;
export const cap = (k: CapKey): Capability => CAP[k];
export const isEnabled = (k: CapKey): boolean => CAP[k] !== "not-built";

/** Human label for the header/system badges. */
export const WRITE_BADGE = "Write-enabled: Goods · Purchases · Sales";
