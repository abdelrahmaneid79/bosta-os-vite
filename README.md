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

## Deploy (always-live)

Hosted on **Vercel** — the repo already ships `vercel.json` (SPA routing + caching).

1. On [vercel.com](https://vercel.com) → **Add New → Project** → import this repo.
2. Framework preset **Vite** (auto). Build `npm run build`, output `dist`.
3. Add the two env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Every `git push` to `main` redeploys automatically.

Your data lives in Supabase, so the same live URL shows the same books on every
device once you sign in.

## Install as an app (PWA)

BostaOS is an installable PWA (`public/manifest.webmanifest` + mascot icons).
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu → *Install app*.
- **Desktop (Chrome/Edge):** install icon in the address bar.

It opens full-screen, standalone, with the Bosta mascot icon.

## Portability

Node **≥ 20** (`.nvmrc` pins 20). Copy the folder (or `git clone`) to any machine,
add `.env`, then `npm install && npm run dev`. `node_modules/` and `dist/` are
regenerated — you never carry them around.

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
