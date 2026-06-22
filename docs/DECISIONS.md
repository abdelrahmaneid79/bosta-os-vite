# BostaOS — Rebuild Decision Log

A running record of the architectural decisions behind the Vite rebuild.

## D1 — Clean rebuild, not a migration
There was **no Next.js codebase in this repo** — only a Claude Design HTML prototype
(now in `_archive_old_next_app/project/`). BostaOS v2 is built from first principles;
no old "brain" was copied. The prototype is a *visual* reference only.

## D2 — Stack
Vite + React + TypeScript + Tailwind + Supabase JS + React Router + TanStack Query +
Zustand (UI-only) + Zod + Recharts + PapaParse/XLSX. SPA, single-admin.

## D3 — One operational brain (`src/core/brain`)
All financial truth lives in pure, tested functions. **React components never
calculate.** Components display data and trigger actions; the brain computes; the DB
layer reads/writes; validation guards inputs.

## D4 — Inventory is a movement ledger
On-hand stock is **derived** from `inventory_movements` (never a stored column that
drifts). Weighted-average COGS is captured on each sale movement at sale time, so
historical profit stays correct as cost moves. Edits reverse + reapply; deletes
restore stock.

## D5 — Withdrawals ≠ expenses
Personal withdrawals are a **cash movement**, excluded from operating expenses and
profit, included in cash-out. Keeps margin honest.

## D6 — Cheque periods are first-class
Settlement is a dynamic period: accumulated sales − deductions = expected cheque;
received vs expected drives status + anomaly flags. **Deductions are configured, never
hardcoded.**

## D7 — Data-source seam + demo mode
`src/core/db/repo.ts` is the single seam. With Supabase env set → live, RLS-secured
queries. Without → an **isolated demo seed** (`src/core/db/mock`) shown behind a
visible "Demo data" banner. Demo data never leaks into real surfaces, and writes are
guarded.

## D8 — Strongly-typed client caveat
The generated `Database` type didn't fully satisfy supabase-js's strict literal
`.from()` typing, so all writes route through the repo's string-based, casted methods
with **client-generated UUIDs** (so stock movements can reference their parent without
a round-trip). Revisit when running `supabase gen types`.

## D9 — Security
Single-admin, but every table is **owner-scoped via RLS** (`owner_id = auth.uid()`),
so the public anon key is safe. Only the anon key ships to the client; service_role
never does. Server-only work (OCR, AI) is reserved for Edge Functions.

## D10 — No destructive DB actions
`supabase/schema.sql` is an **additive proposal** (`create table if not exists`). It
has not been run. No migrations executed; no data touched.
