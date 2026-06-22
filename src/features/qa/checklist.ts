/** Static catalogue of every write flow, for the in-app QA checklist. Mirrors
 *  the readiness matrix in docs/TESTING.md so the owner can verify each one
 *  locally and mark its status. Pure data — no logic, no I/O. */
export interface QAFlow {
  id: string;
  group: string;
  screen: string;   // where to do it
  action: string;   // what to click
  expected: string; // what should happen
  touches: string;  // table / RPC it exercises
}

export const QA_FLOWS: QAFlow[] = [
  // Goods
  { id: "goods-create", group: "Goods", screen: "Goods", action: "+ Product → name + price → Save", expected: "Appears in list; toast “Added …”", touches: "products (insert)" },
  { id: "goods-edit", group: "Goods", screen: "Goods", action: "Tap product → change price → Save", expected: "List updates; toast “Updated …”", touches: "products (update)" },
  { id: "goods-active", group: "Goods", screen: "Goods", action: "Edit → untick Active → Save", expected: "Shows “inactive” badge", touches: "products (update)" },

  // Purchases
  { id: "purchase-create", group: "Purchases", screen: "Buy", action: "+ Purchase → product, qty (base units), unit cost → Save", expected: "Stock + qty; weighted cost shows; toast shows stock change", touches: "RPC create_purchase" },
  { id: "purchase-backdated", group: "Purchases", screen: "Buy", action: "+ Purchase with a past date", expected: "Warning shown; prior sales keep their captured cost", touches: "RPC create_purchase" },

  // Sales
  { id: "sale-create", group: "Sales", screen: "Sales", action: "+ Sale → date + day total → Save", expected: "Appears in Recent; toast shows revenue", touches: "sales (insert)" },
  { id: "sale-dup", group: "Sales", screen: "Sales", action: "+ Sale on a date that already exists", expected: "Blocked: “already exists for that day”", touches: "sales (guard)" },
  { id: "sale-line-add", group: "Sales", screen: "Sales → open day", action: "+ Add product line → product, qty, price → Save", expected: "On-hand − qty; COGS captured", touches: "RPC create_sale_item" },
  { id: "sale-line-edit", group: "Sales", screen: "Sales → open day", action: "✎ on a line → change qty → Save", expected: "Stock reverses old + applies new (net change)", touches: "RPC update_sale_item" },
  { id: "sale-line-void", group: "Sales", screen: "Sales → open day", action: "✕ on a line → Confirm", expected: "Stock restored; line removed", touches: "RPC delete_sale_item" },
  { id: "sale-day-void", group: "Sales", screen: "Sales → open day", action: "Void whole day → Confirm", expected: "Day voided; movements reversed; revenue drops", touches: "RPC void_sale_movements + sales" },

  // Expenses
  { id: "expense-add", group: "Expenses", screen: "Spend", action: "+ Expense → category + amount → Save", expected: "Total ↑; net profit ↓ (cash unchanged)", touches: "expenses (insert)" },
  { id: "expense-void", group: "Expenses", screen: "Spend", action: "✕ → Confirm", expected: "Removed from total; kept for audit", touches: "expenses (update)" },

  // Cash
  { id: "cash-in", group: "Cash", screen: "Cash", action: "+ Cash in → amount → Save", expected: "Balance recalculated; profit unaffected", touches: "money_movements + RPC recalc_money_account" },
  { id: "cash-out", group: "Cash", screen: "Cash", action: "− Cash out → amount → Save", expected: "Balance ↓; profit unaffected", touches: "money_movements + recalc" },
  { id: "cash-withdraw", group: "Cash", screen: "Cash", action: "Withdraw → amount → Save", expected: "Balance ↓; never an expense; profit unaffected", touches: "money_movements (personal_withdrawal) + recalc" },
  { id: "cash-count", group: "Cash", screen: "Cash", action: "Count cash → enter counted → Save", expected: "Adjustment lands balance on reality; difference shown", touches: "cash_reconciliations + money_movements + recalc" },
  { id: "cash-void", group: "Cash", screen: "Cash", action: "✕ on a movement → Confirm", expected: "Balance recomputed", touches: "money_movements (update) + recalc" },

  // Cheques / settlements
  { id: "settle-open", group: "Cheques", screen: "Cheques", action: "Open this month", expected: "Period appears (rent + share seeded); idempotent", touches: "RPC ensure_monthly_settlement_period" },
  { id: "cheque-record", group: "Cheques", screen: "Cheques", action: "+ Cheque → status received → amount + date → Save", expected: "Appears with expected/received/diff", touches: "cheques (insert)" },
  { id: "cheque-reconcile", group: "Cheques", screen: "Cheques", action: "reconcile → Confirm", expected: "Status → reconciled", touches: "cheques (update)" },
  { id: "cheque-void", group: "Cheques", screen: "Cheques", action: "✕ → Confirm", expected: "Removed from totals; kept for audit", touches: "cheques (update)" },

  // Imports
  { id: "import-sales", group: "Imports", screen: "Imports", action: "Daily sales CSV → preview → Approve", expected: "New days created; existing dates skipped (dedup)", touches: "sales (insert loop)" },
  { id: "import-expenses", group: "Imports", screen: "Imports", action: "Expenses CSV → preview → Approve", expected: "Expenses created; new categories created", touches: "expenses + expense_categories" },

  // Settings
  { id: "settings-low", group: "Settings", screen: "Settings", action: "Set tracking start / low-stock default → Save", expected: "Persists", touches: "app_settings (upsert)" },
  { id: "settings-terms", group: "Settings", screen: "Settings", action: "Set rent / share → Confirm", expected: "New effective-dated term; future periods use it", touches: "location_terms (insert)" },
];

export const QA_GROUPS = [...new Set(QA_FLOWS.map((f) => f.group))];
