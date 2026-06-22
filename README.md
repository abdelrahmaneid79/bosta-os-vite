# BostaOS

The financial brain and operating system of **Bosta Bites** — a single-admin business
app. Rebuilt clean on **Vite + React + TypeScript + Tailwind + Supabase**.

> Open BostaOS and within 30 seconds know: what you sold, whether you profited, where
> the money went, what stock moved, what cash you should have, what cheque is due, and
> what needs attention.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (runs in demo mode with sample data)
npm test           # business-engine unit tests
npm run build      # typecheck + production build
```

Without Supabase env vars the app runs in **demo mode** (isolated sample data behind a
banner). To go live:

```bash
cp .env.example .env
# fill in:
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Then apply the schema in a **non-production** Supabase project first:
`supabase/schema.sql` (additive, RLS-secured, single-admin). It has not been run for you.

## Architecture

```
src/
  app/          App, router, providers
  core/
    brain/      ⬅ the one operational brain — pure, tested business logic
    db/         supabase client, auth, repo (data seam), queries, mutations, mappers, mock
    types/      domain.ts (app models) + database.ts (DB rows)
    validation/ zod schemas
    utils/      formatting, dates, cn
  features/     dashboard, products, sales, expenses, inventory, cash, cheques,
                imports, reports, health, missing-data, settings, system-check, auth
  components/   ui, forms, charts, layout, feedback
  store/        zustand (UI-only: toasts, command center)
```

**Rule:** components display + trigger actions; the **brain** calculates; the **db**
layer reads/writes; **validation** guards inputs. No business math in components.

## What the brain knows
Revenue · weighted-average COGS · inventory (movement ledger, auto stock in/out,
reversible edits) · profit (withdrawals excluded) · expected vs actual cash · dynamic
cheque/settlement periods · health score · missing-data detection · reports.

See `docs/DECISIONS.md` (why) and `docs/TESTING.md` (how to verify).

The original Claude Design prototype and prior reference live in
`_archive_old_next_app/`.
