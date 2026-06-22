# Apply BostaOS v2 (Vite, read-only) on your machine

This zip is the canonical Vite app. Your local `BostaOS Vite` folder never received
the cloud edits (no shared git remote), which is why your browser didn't change.

## Use it
1. Extract this zip into a folder (or replace the contents of your `BostaOS Vite`).
2. Create `.env` in the root (anon key = read-only, no cost):
   ```
   VITE_SUPABASE_URL=https://vvswohkqypzjtmfnpmba.supabase.co
   VITE_SUPABASE_ANON_KEY=<your anon public key>
   ```
3. Install + run:
   ```
   npm install
   npm run dev        # http://localhost:5173
   ```
4. Sign in with your Supabase account.

## What you should now SEE (vs the old plain app)
- A **slim pink-accented left rail**: pink mascot block, central **+** button, icon+label
  nav (Today, Sales, Goods, Buy, Cash, Cheques, Profit, Reports, Health, Gaps), Settings/System at the bottom.
- A **big Fredoka page title** with subtitle **“Bosta Bites · <Month Year> · read-only”**, a search box and a pink **B** avatar.
- **Jet-black background with a pink glow** top-right; **mint-green** for healthy, **hot-pink** active nav.
- **Today**: glow hero with today’s revenue, mini stats, attention list, a health **ring**.
- **Health**: big mint **ring (score/100)**, “Strong & steady”, **Level / streak pills**, Helping/Hurting, category cards with a ring + reason + “↑ lift”.
- **Profit**: huge gross-profit number + **breakdown bars** (revenue / − COGS / = profit), “unknown” when cost data is incomplete.
- **Mobile**: bottom scroll nav, single-column cards, **+** in the header.

Nothing writes to Supabase: the **+** sheet and all action buttons are visibly **disabled**.
