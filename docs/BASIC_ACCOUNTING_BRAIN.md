# Basic Accounting Brain

A separate, deterministic layer that reads Bosta Bites' real, messy exports and
produces ONE clean ledger of **editable entries** (not hard-coded numbers). Code
lives in `src/core/accounting/brain.ts` (pure + unit-tested). The cleaned data
ships as CSVs in `docs/seed/` for you to import — they become normal rows you can
view, edit and delete like any other.

## The sources I absorbed (9 files)
| File | What it really is | Used for |
|---|---|---|
| `daily sales 30.10.24 till 24,5,26.Xls` | POS "صافى مبيعات الموردين" net daily sales report, **Oct 30 2024 → May 24 2026** | **Daily revenue** (authoritative) |
| `bosta bites heikal accounting till may.xlsx` / `عبد الرحمن عوض.xlsx` | Same hand-kept monthly ledger (Mar–May 2026) — duplicates of each other | fills missing sales days + 2026 bills |
| `product sales from 10.30.24.Xls` | POS per-product totals (name, **barcode**, value, qty, avg price) | Product master (59 products) |
| `Expense.xlsx` | Zoho expense export | Operating expenses |
| `Bill.xlsx` / `partial 2025 expenses.xlsx` / `random expenses.xlsx` | Zoho bill export (one row per line-item) + a copy of the expenses — all duplicates | Purchases (bills) + expenses |
| `bosta_bites_cheque_memory.csv` | Settlement cheques received from the mall | Cheques |

## Rules the brain enforces (this is the logic, saved)
1. **Revenue = POS net value** (`صافى القيمة` = gross − returns), exactly one figure per day. Never sum product lines into revenue; never read a barcode/16-digit code or item-code as money.
2. **Double days** (same date appearing twice) are **de-duplicated, not added**.
3. A **bill exported per line-item is one purchase** — collapse by Bill ID (the total repeats on every line).
4. **Identical expense rows** that recur across the duplicate files are **de-duplicated** by (date, category, amount, vendor).
5. **Cheques are money received** (settlement), a separate ledger — they **never touch profit**.
6. **Source priority:** when two sources overlap, the **authoritative one wins**; the other only fills **missing days** (the hand-sheet added 7 days after the POS export's May-24 cut-off).
7. **Dates** are normalised to ISO (`YYYY/MM/DD`, `D/M/Y`, Excel dates → `YYYY-MM-DD`).

## Reconciliation (what came out)
| Ledger | Clean entries | Total (EGP) | Range | Dedupe notes |
|---|---|---|---|---|
| **Daily sales** | **579 days** | **2,724,777** | 2024-10-30 → 2026-05-31 | POS net (2,685,749) + 7 hand-sheet days; 85 overlapping days kept from POS |
| Products | 59 | 2,685,749 (value) | — | top: جامى جيلى كاندى **444,234** ✓ matches POS |
| Expenses | 33 | 157,830 | 2025-06 → 2025-12 | duplicates across 4 files collapsed |
| Purchases (bills) | 64 | 597,399 | 2025-06 → 2026-05 | 299 bill rows → 42 unique Zoho bills + 22 hand-sheet 2026 bills |
| Cheques | 38 | 1,528,449 | 2025-06 → 2026-06 | settlement money received |

Cross-checks that prove the read is right: 2024-12-03 net = **3,403.17** (matches the
printed sheet); all-time revenue **≈ 2.69M** and top product **444,234** match the
figures you already had.

## How it lands in BostaOS (as editable entries)
1. `docs/seed/*.csv` are the cleaned ledgers: `daily_sales.csv`, `expenses.csv`,
   `purchases.csv`, `cheques.csv`, `products.csv` (with barcodes), `purchase_items.csv`.
2. Import them through **Sales → Import & receipts** (sales) and **Money → Import
   expenses** — each row becomes a normal entry you can edit/delete.
3. Future messy uploads pass through the same brain (`brain.ts`) so the rules
   above are applied automatically — no hard-coded totals anywhere.
