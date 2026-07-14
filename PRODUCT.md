# BostaOS — PRODUCT.md

## Register
product — app UI. Design SERVES the product. The interface should disappear behind the information.

## Users & Purpose
- **Sole user:** Abdelrahmane, owner-operator of Bosta Bites (premium nuts/candy concession in a hypermarket, Cairo). Non-developer. Uses BostaOS on a Mac and on his phone at the stand.
- **Job:** run the business — see what matters, why it matters, and what to do next, in seconds. Enter daily records fast (sales, expenses, counts, closes) with one hand on a phone at the stand.
- **Primary workflow:** morning check (daily brief → exceptions → one primary action) and end-of-day close. Weekly: act on strategist recommendations, purchases, cheques.

## Design objective (owner directive, 2026-07)
Optimise for **speed of decision-making**, not beauty. Every screen answers: What matters? Why? What should I do next? One visual focal point, one obvious primary action per screen.

## Brand personality
Premium executive operating system. Calm, dense-but-clear, confident, dark. "Sitting in front of an executive OS" — not a chatbot, not ChatGPT, not an admin dashboard.

## Quality bar (interaction/hierarchy/clarity, not appearance)
Linear · Revolut Business · Apple system apps · Stripe Dashboard · Notion Calendar · Raycast.

## Anti-references (owner-stated)
- admin-dashboard aesthetics, visual noise, unnecessary cards, duplicated info
- excessive icons, oversized buttons, cramped spacing
- chatbot-shaped strategist; long unstructured paragraphs
- decorative redesigns that slow decisions

## Visual system (committed — preserve identity)
- Dark default. Brand accent `#ff4dbb` (magenta) used sparingly for the primary action/focal point.
- Peanut logo. Existing token system: `--cd-*` deck tokens + Tailwind RGB-triplet vars (`rgb(var(--text))`, `var(--surface2)`, `var(--stroke)`).
- Truth-level colors in Strategist: green=measured, amber=inference, cyan=test.

## Hard constraints
- **Never change:** business logic, calculations, strategist reasoning, DB schema, Supabase logic, financial rules, imports, recommendation engine, auth, data models.
- Mobile is first-class: different layouts where needed (tables→cards, filters→drawers, sections collapse), equivalent usability.
- Progressive disclosure over cramming; fewer borders, calmer color, stronger type hierarchy.
- Numbers are the product: tabular numerals, honest states (missing ≠ zero), evidence always one tap away.

## Flagship
The Strategist screen — an executive briefing surface: conclusion → impact → evidence → action → confidence → blockers → success criteria, structured, never a wall of prose.
