/** The deterministic strategy engine — PURE, no I/O, fully unit-tested.
 *
 *  Pipeline: detectChanges → findDrivers → findContradictions →
 *  dataQualityFindings → rankFindings. The LLM receives the ranked findings
 *  and explains/prioritizes them; it never has to (and must not) discover
 *  numbers on its own.
 *
 *  Honesty rules encoded here:
 *  - A metric with basis "missing" can never produce a fact/warning claim —
 *    only a data_quality finding.
 *  - No trend claim without ≥2 comparable periods.
 *  - Cash and profit are never mixed: a profit finding cites profit metrics,
 *    a cash finding cites cash metrics.
 *  - Withdrawals are compared against profit as an OWNER-DRAW question,
 *    never as an expense. */
import type { Metric, StrategistSnapshot } from "../contract";
import type { ActionCandidate, Evidence, Finding, FindingConfidence, Urgency } from "./types";

const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Evidence straight from a metric — the only legal way to cite a number. */
export function ev(label: string, m: Metric<unknown>, format?: (v: unknown) => string): Evidence {
  const v = m.value;
  const value = v == null ? `unknown — ${m.note ?? "missing"}` : format ? format(v) : typeof v === "number" ? egp(v) : String(v);
  return { label, value, source: m.source, period: m.period, screenLink: m.screenLink };
}

type FindingSeed = Omit<Finding, "score" | "rank" | "drivers" | "assumptions" | "resolutionCriteria" | "alternativeAction" | "persistEligible"> &
  Partial<Pick<Finding, "drivers" | "assumptions" | "resolutionCriteria" | "alternativeAction">>;

function finding(f: FindingSeed): Finding {
  return {
    drivers: [], assumptions: [], alternativeAction: null,
    resolutionCriteria: "the engine stops raising this finding on a newer snapshot",
    ...f,
    persistEligible: false, // set by rankFindings via the persistence rule
    score: 0, rank: 0,
  };
}

/** Persistence eligibility — the ENGINE owns this rule; the persistence layer
 *  only executes it. Not every transient observation deserves memory. */
export function shouldPersistFinding(f: Pick<Finding, "class" | "urgency" | "impactEgp">): boolean {
  if (f.class === "contradiction" || f.class === "decision_risk") return true;
  if (f.urgency === "today") return true;
  if ((f.impactEgp ?? 0) >= 5_000) return true;
  if (f.class === "data_quality" && f.urgency !== "monitor") return true;
  return false;
}

function action(a: Partial<ActionCandidate> & Pick<ActionCandidate, "title" | "action" | "rationale" | "screenLink">): ActionCandidate {
  return {
    expectedImpact: a.expectedImpact ?? "unquantified — see caveats",
    urgency: a.urgency ?? "this_week",
    confidence: a.confidence ?? "medium",
    missingData: a.missingData ?? [],
    caveats: a.caveats ?? [],
    reversible: a.reversible ?? true,
    ...a,
  };
}

/* ═══ 1. CHANGES ══════════════════════════════════════════════════════ */

export function detectChanges(s: StrategistSnapshot): Finding[] {
  const out: Finding[] = [];
  const rev = s.revenue;

  // history guard: no trend claims without at least 2 months of books
  const months = s.revenue.monthlySeries.value ?? [];
  if (months.length < 2) {
    out.push(finding({
      id: "insufficient-history", class: "fact",
      title: "Not enough history for trend analysis",
      detail: `Only ${months.length} month(s) of sales exist — period-over-period claims would be noise, so none are made.`,
      evidence: [ev("Months of data", rev.monthlySeries, (v) => String((v as unknown[]).length))],
      impactEgp: null, urgency: "monitor", confidence: "high",
      actionable: false, action: null, missingData: ["more trading history"],
    }));
    return out;
  }

  if (rev.changePct.value != null && rev.periodRevenue.value != null && rev.priorRevenue.value != null) {
    const c = rev.changePct.value;
    if (Math.abs(c) >= 10) {
      const up = c > 0;
      out.push(finding({
        id: up ? "revenue-up" : "revenue-down",
        class: up ? "fact" : "warning",
        title: `Revenue ${up ? "up" : "down"} ${pct(Math.abs(c))} vs the prior period`,
        detail: `${egp(rev.periodRevenue.value)} this period vs ${egp(rev.priorRevenue.value)} prior.`,
        evidence: [ev("Period revenue", rev.periodRevenue), ev("Prior period", rev.priorRevenue), ev("Change", rev.changePct, (v) => pct(v as number))],
        impactEgp: Math.abs(rev.periodRevenue.value - rev.priorRevenue.value),
        urgency: up ? "monitor" : "this_week",
        confidence: "high",
        drivers: (up ? s.products.fastestGrowing.value : s.products.fastestDeclining.value ?? [])?.slice(0, 3).map((p) => `${p.name} (${pct(p.changePct)})`) ?? [],
        resolutionCriteria: "period revenue within 10% of the comparison period on a newer snapshot",
        actionable: !up,
        action: up ? null : action({
          title: "Find the revenue leak",
          action: "Open Sales and compare the weakest days and declining products against the prior period.",
          rationale: "A double-digit drop is rarely uniform — it concentrates in specific days or products.",
          screenLink: "/sales",
        }),
        missingData: [],
      }));
    }
  }

  // margin move (only when both periods are measurable)
  const m = s.profit.grossMarginPct, mp = s.profit.priorGrossMarginPct;
  if (m.value != null && mp.value != null && Math.abs(m.value - mp.value) >= 3) {
    const drop = m.value < mp.value;
    const pts = Math.abs(m.value - mp.value);
    const covered = s.profit.coveredRevenue.value ?? 0;
    out.push(finding({
      id: drop ? "margin-drop" : "margin-gain",
      class: drop ? "warning" : "fact",
      title: `Gross margin ${drop ? "fell" : "rose"} ${pts.toFixed(1)} points (${pct(mp.value)} → ${pct(m.value)})`,
      detail: `Measured on covered revenue only (${pct(s.profit.coveredRevenue.completeness ?? 0)} of revenue has product detail).`,
      evidence: [ev("Gross margin", m, (v) => pct(v as number)), ev("Prior margin", mp, (v) => pct(v as number)), ev("Covered revenue", s.profit.coveredRevenue)],
      impactEgp: Math.round((pts / 100) * covered),
      urgency: drop ? "this_week" : "monitor",
      confidence: m.confidence === "high" ? "high" : "medium",
      drivers: (s.products.highVolumeLowMargin.value ?? []).slice(0, 3).map((p) => p.name),
      resolutionCriteria: `gross margin back within 2 points of the prior period (${pct(mp.value)})`,
      actionable: drop,
      action: drop ? action({
        title: "Trace the margin erosion",
        action: "Review the high-volume low-margin list and recent supplier costs before buying more volume.",
        rationale: "Margin drops of this size usually come from product mix shifting toward weaker items or a cost increase not passed on.",
        expectedImpact: `${egp((pts / 100) * covered)} per period if restored`,
        screenLink: "/reports",
      }) : null,
      missingData: (s.profit.coveredRevenue.completeness ?? 100) < 95 ? ["full product-line coverage for the period"] : [],
    }));
  }

  // performance vs target (owner target, else trailing-3-month rule)
  const target = s.context.monthlyRevenueTarget.value;
  const trailing3 = months.slice(-4, -1); // exclude the current period month
  const baseline = target ?? (trailing3.length === 3 ? trailing3.reduce((a, b) => a + b.value, 0) / 3 : null);
  if (baseline != null && rev.periodRevenue.value != null && baseline > 0) {
    const gap = ((rev.periodRevenue.value - baseline) / baseline) * 100;
    if (gap <= -10) {
      out.push(finding({
        id: "behind-target", class: "warning",
        title: `Revenue is ${pct(Math.abs(gap))} behind ${target != null ? "your target" : "the trailing-3-month average"}`,
        detail: `${egp(rev.periodRevenue.value)} vs a baseline of ${egp(baseline)}${target == null ? " (no owner target set — using the documented default)" : ""}.`,
        evidence: [ev("Period revenue", rev.periodRevenue), ev("Target basis", s.context.monthlyRevenueTarget, () => egp(baseline))],
        impactEgp: Math.round(baseline - rev.periodRevenue.value),
        urgency: "this_week", confidence: target != null ? "high" : "medium",
        assumptions: target == null ? ["baseline = trailing-3-month average (no owner target confirmed)"] : [],
        resolutionCriteria: "period revenue within 10% of the baseline",
        actionable: true,
        action: action({
          title: "Close the gap to plan",
          action: "Check whether the shortfall is fewer trading days, weaker weekends, or specific products — each has a different fix.",
          rationale: "A revenue gap has exactly three shapes here: volume, calendar, or mix.",
          screenLink: "/sales",
        }),
        missingData: target == null ? ["owner revenue target (using trailing-3-month default)"] : [],
      }));
    }
  }

  // unusual days worth a look
  const unusual = rev.unusualDays.value ?? [];
  if (unusual.length > 0) {
    const top = unusual[0];
    out.push(finding({
      id: "unusual-days", class: "fact",
      title: `${unusual.length} statistically unusual sales day(s) this period`,
      detail: `Largest outlier: ${top.date} at ${egp(top.total)} (>2.5σ from the period mean).`,
      evidence: [ev("Unusual days", rev.unusualDays, (v) => (v as { date: string }[]).map((d) => d.date).join(", "))],
      impactEgp: null, urgency: "monitor", confidence: "medium",
      actionable: false, action: null, missingData: [],
    }));
  }

  return out;
}

/* ═══ 2. DRIVERS ══════════════════════════════════════════════════════ */

export function findDrivers(s: StrategistSnapshot): Finding[] {
  const out: Finding[] = [];
  const conf = s.products.topRevenue.confidence;
  if (conf === "none") return out; // no product coverage → drivers unknowable (data-quality reports it)

  const grown = s.products.fastestGrowing.value ?? [];
  if (grown.length) {
    const g = grown[0];
    out.push(finding({
      id: "growth-driver", class: "fact",
      title: `${g.name} is the fastest-growing product (+${pct(g.changePct)})`,
      detail: `${egp(g.revenue)} this period${g.marginPct != null ? ` at ${pct(g.marginPct)} margin` : " — margin unknown (missing cost)"}.`,
      evidence: [ev("Fastest growing", s.products.fastestGrowing, (v) => (v as { name: string }[]).slice(0, 3).map((p) => p.name).join(", "))],
      impactEgp: g.revenue, urgency: "monitor",
      confidence: conf === "high" ? "high" : "medium",
      actionable: g.marginPct == null,
      action: g.marginPct == null ? action({
        title: `Add a cost for ${g.name}`,
        action: `Record ${g.name}'s purchase cost so its real profitability is known before you push it harder.`,
        rationale: "It's growing fast with unknown margin — could be your best or worst performer.",
        screenLink: "/costs", urgency: "this_week",
      }) : null,
      missingData: g.marginPct == null ? [`${g.name} cost`] : [],
    }));
  }

  const declined = s.products.fastestDeclining.value ?? [];
  if (declined.length) {
    const d = declined[0];
    out.push(finding({
      id: "decline-driver", class: "warning",
      title: `${d.name} is declining fastest (${pct(d.changePct)})`,
      detail: `${egp(d.revenue)} this period, down vs the prior period.`,
      evidence: [ev("Fastest declining", s.products.fastestDeclining, (v) => (v as { name: string }[]).slice(0, 3).map((p) => p.name).join(", "))],
      impactEgp: null, urgency: "this_month",
      confidence: conf === "high" ? "high" : "medium",
      actionable: true,
      action: action({
        title: `Diagnose ${d.name}`,
        action: `Check ${d.name}: availability (was it in stock?), price change, or placement — then decide to fix or phase out.`,
        rationale: "Consistent decline in a previously-selling product is usually availability or price, not taste.",
        screenLink: "/reports",
      }),
      missingData: [],
    }));
  }

  // stock risk — only when inventory actually has data (else data_quality owns it)
  if (s.inventory.hasLiveData && s.products.stockRisk.value != null) {
    const risky = s.products.stockRisk.value;
    const topNames = new Set((s.products.topRevenue.value ?? []).slice(0, 5).map((p) => p.name));
    const fastAtRisk = risky.filter((r) => topNames.has(r.name));
    if (risky.length > 0) {
      const urgent = fastAtRisk.length > 0;
      out.push(finding({
        id: "stock-risk", class: "warning",
        title: urgent
          ? `Top seller${fastAtRisk.length > 1 ? "s" : ""} at stock risk: ${fastAtRisk.map((r) => r.name).join(", ")}`
          : `${risky.length} product(s) low or negative on stock`,
        detail: urgent
          ? "A best-selling product running out costs revenue you can see — restock before the shelf gaps."
          : `Low/negative: ${risky.slice(0, 5).map((r) => r.name).join(", ")}${risky.length > 5 ? "…" : ""}.`,
        evidence: [ev("Stock risk", s.products.stockRisk, (v) => (v as { name: string }[]).slice(0, 5).map((x) => x.name).join(", "))],
        impactEgp: null,
        urgency: urgent ? "today" : "this_week",
        confidence: "medium",
        actionable: true,
        action: action({
          title: urgent ? `Restock ${fastAtRisk[0].name}` : "Review low-stock list",
          action: urgent
            ? `Order ${fastAtRisk[0].name} now — it is both a top revenue product and low on stock.`
            : "Open Stock and restock or deactivate the flagged products.",
          rationale: "Stockouts on proven sellers are the most expensive kind of missing inventory.",
          screenLink: "/stock", urgency: urgent ? "today" : "this_week",
        }),
        missingData: [],
      }));
    }
  }

  // overdue settlement periods — money owed and aging
  const overdue = s.cheques.overduePeriods.value ?? [];
  if (overdue.length > 0) {
    out.push(finding({
      id: "overdue-cheques", class: "warning",
      title: `${overdue.length} settlement period(s) overdue with no cheque: ${overdue.join(", ")}`,
      detail: "These periods ended more than 45 days ago with expected money and no recorded cheque.",
      evidence: [ev("Overdue periods", s.cheques.overduePeriods, (v) => (v as string[]).join(", ")), ev("Total received to date", s.cheques.totalReceived)],
      impactEgp: null, urgency: "this_week", confidence: "high",
      actionable: true,
      action: action({
        title: "Chase the overdue periods",
        action: `Ask mall admin for the statements/cheques covering ${overdue.join(", ")}, or mark the periods if the cheque was received but not recorded.`,
        rationale: "45+ days past period end is beyond the normal settlement lag.",
        screenLink: "/settlements",
      }),
      missingData: ["whether these cheques were received but not recorded"],
    }));
  }

  const spikes = s.expenses.spikes.value ?? [];
  for (const sp of spikes.slice(0, 2)) {
    out.push(finding({
      id: `expense-spike-${sp.name.toLowerCase().replace(/\s+/g, "-")}`, class: "warning",
      title: `${sp.name} expenses spiked ${pct(sp.changePct)} vs the prior period`,
      detail: `${egp(sp.value)} this period in ${sp.name}.`,
      evidence: [ev("Category spikes", s.expenses.spikes, () => `${sp.name}: ${egp(sp.value)} (+${pct(sp.changePct)})`)],
      impactEgp: Math.round(sp.value - sp.value / (1 + sp.changePct / 100)),
      urgency: "this_week", confidence: "high",
      actionable: true,
      action: action({
        title: `Review ${sp.name} spend`,
        action: `Open Expenses filtered to ${sp.name} and check whether the increase is a one-off, a price rise, or a booking error.`,
        rationale: "Category spikes >30% are either real cost inflation or a data mistake — both need catching early.",
        screenLink: "/expenses",
      }),
      missingData: [],
    }));
  }

  return out;
}

/* ═══ 3. CONTRADICTIONS ═══════════════════════════════════════════════ */

export function findContradictions(s: StrategistSnapshot): Finding[] {
  const out: Finding[] = [];
  const rev = s.revenue, prof = s.profit;

  // revenue up, margin down — growing while economics weaken
  if (rev.changePct.value != null && rev.changePct.value > 5 &&
      prof.grossMarginPct.value != null && prof.priorGrossMarginPct.value != null &&
      prof.grossMarginPct.value < prof.priorGrossMarginPct.value - 2) {
    const pts = prof.priorGrossMarginPct.value - prof.grossMarginPct.value;
    out.push(finding({
      id: "growth-weaker-economics", class: "contradiction",
      title: `Selling more, earning less per pound: revenue +${pct(rev.changePct.value)} but margin −${pts.toFixed(1)} points`,
      detail: "Growth is coming from lower-margin volume. Pushing harder without fixing mix or cost locks the weaker economics in.",
      evidence: [ev("Revenue change", rev.changePct, (v) => pct(v as number)), ev("Margin now", prof.grossMarginPct, (v) => pct(v as number)), ev("Margin before", prof.priorGrossMarginPct, (v) => pct(v as number))],
      impactEgp: Math.round((pts / 100) * (prof.coveredRevenue.value ?? 0)),
      urgency: "this_week", confidence: prof.grossMarginPct.confidence === "high" ? "high" : "medium",
      actionable: true,
      action: action({
        title: "Fix mix before volume",
        action: "Review pricing or purchase cost on the high-volume low-margin products before increasing their volume further.",
        rationale: "The growth is real but each incremental pound earns less than before.",
        screenLink: "/reports",
      }),
      missingData: [],
    }));
  }

  // profit healthy on paper, cash unknown/negative — only when cash data exists
  if (s.cash.hasLiveData && prof.netProfit.value != null && prof.netProfit.value > 0 &&
      s.cash.expectedBalance.value != null && s.cash.expectedBalance.value < (s.context.cashReserveFloor.value ?? 0)) {
    out.push(finding({
      id: "profit-up-cash-low", class: "contradiction",
      title: "Profitable on paper, but cash is below your reserve floor",
      detail: `Net profit ${egp(prof.netProfit.value)} this period, yet expected cash ${egp(s.cash.expectedBalance.value)} sits under the ${egp(s.context.cashReserveFloor.value ?? 0)} floor. Profit is timing; cash is survival.`,
      evidence: [ev("Net profit", prof.netProfit), ev("Expected cash", s.cash.expectedBalance), ev("Reserve floor", s.context.cashReserveFloor)],
      impactEgp: Math.round((s.context.cashReserveFloor.value ?? 0) - s.cash.expectedBalance.value),
      urgency: "today", confidence: "medium",
      actionable: true,
      action: action({
        title: "Reconcile the cash gap",
        action: "Check the open settlement tab (money stuck with the mall) and any withdrawals before committing new spend.",
        rationale: "The profit exists — it's parked in the settlement cycle or already drawn out.",
        screenLink: "/money", urgency: "today",
      }),
      missingData: [],
    }));
  }

  // withdrawals vs profit — the owner-draw rule (NEVER an expense comparison)
  const wd = s.expenses.withdrawals.value ?? 0;
  if (wd > 0 && prof.netProfit.value != null) {
    const limit = prof.netProfit.value * 0.5;
    if (wd > limit) {
      out.push(finding({
        id: "withdrawals-high", class: "decision_risk",
        title: `Withdrawals (${egp(wd)}) exceed 50% of the period's net profit`,
        detail: `Your rule: "${s.context.withdrawalRule.value}". Net profit ${egp(prof.netProfit.value)} → guideline max ${egp(limit)}. Withdrawals are owner draws, not expenses — but they drain the same cash.`,
        evidence: [ev("Withdrawals", s.expenses.withdrawals), ev("Net profit", prof.netProfit), ev("Rule", s.context.withdrawalRule, (v) => String(v))],
        impactEgp: Math.round(wd - limit),
        urgency: "this_week", confidence: "high",
        resolutionCriteria: "period withdrawals back under 50% of the same period's net profit",
        alternativeAction: "If this draw was planned (e.g. a personal commitment), note it in Tune so the strategist stops flagging it this month.",
        actionable: true,
        action: action({
          title: "Pace the draws",
          action: `Hold further withdrawals until the cheque for the open period lands, or cap this month at ${egp(limit)}.`,
          rationale: "Drawing faster than profit accrues eats the cash buffer that carries the shop between cheques.",
          screenLink: "/money",
        }),
        missingData: [],
      }));
    }
  }

  // strong sales but the settlement pipe is slow / money parked at the mall
  const open = s.cheques.openTabGross.value ?? 0;
  const rev30 = (s.revenue.rolling30Avg.value ?? 0) * 30;
  if (open > 0 && rev30 > 0 && open > rev30 * 1.2) {
    out.push(finding({
      id: "settlement-lag", class: "contradiction",
      title: `More than a month of sales (${egp(open)}) is sitting unsettled at the mall`,
      detail: `The open tab exceeds ~120% of a normal month's revenue${s.cheques.lastChequeDate.value ? ` — last cheque ${s.cheques.lastChequeDate.value}` : ""}. Sales look strong; the cash hasn't arrived.`,
      evidence: [ev("Open tab (gross)", s.cheques.openTabGross), ev("Est. net after deductions", s.cheques.openTabEstimatedNet), ev("Last cheque", s.cheques.lastChequeDate, (v) => String(v))],
      impactEgp: s.cheques.openTabEstimatedNet.value,
      urgency: "this_week", confidence: "high",
      actionable: true,
      action: action({
        title: "Chase the settlement",
        action: "Contact mall admin for the pending statement/cheque covering the open period.",
        rationale: "Every week of settlement lag is working capital you're lending the mall for free.",
        screenLink: "/settlements",
      }),
      missingData: [],
    }));
  }

  return out;
}

/* ═══ 4. DATA QUALITY ═════════════════════════════════════════════════ */

export function dataQualityFindings(s: StrategistSnapshot): Finding[] {
  const out: Finding[] = [];

  const unc = s.profit.uncoveredRevenue.value ?? 0;
  const revTotal = s.profit.revenue.value ?? 0;
  if (unc >= 1 && revTotal > 0) {
    const share = (unc / revTotal) * 100;
    out.push(finding({
      id: "uncovered-revenue", class: "data_quality",
      title: `${pct(share)} of this period's revenue has unknowable COGS`,
      detail: `${egp(unc)} sits on days with no product-line detail — margins are measured on the remaining ${pct(100 - share)} only.`,
      evidence: [ev("Unknown-COGS exposure", s.profit.uncoveredRevenue), ev("Coverage", s.products.coveragePct, (v) => pct(v as number))],
      impactEgp: Math.round(unc), urgency: share > 50 ? "this_week" : "this_month",
      confidence: "high", actionable: true,
      action: action({
        title: "Import the missing day reports",
        action: "Load the daily POS report images for the uncovered days (photo importer matches by POS code).",
        rationale: "Every imported day converts guess-free margin coverage directly.",
        screenLink: "/sales/product-lines",
      }),
      missingData: ["daily report images for the uncovered days"],
    }));
  }

  const mc = s.products.missingCosts.value ?? [];
  if (mc.length > 0) {
    out.push(finding({
      id: "missing-costs", class: "data_quality",
      title: `${mc.length} active product(s) have no recorded cost`,
      detail: `Their sold lines carry no COGS, so their margin is withheld. Products: ${mc.slice(0, 5).join(", ")}${mc.length > 5 ? "…" : ""}.`,
      evidence: [ev("Products missing cost", s.products.missingCosts, (v) => String((v as string[]).length))],
      impactEgp: null, urgency: "this_week", confidence: "high",
      actionable: true,
      action: action({
        title: "Fill the missing costs",
        action: "Add reference costs for the listed products (supplier invoice or estimate flagged as estimate).",
        rationale: "Costs unlock real margins on every historical line already imported.",
        screenLink: "/costs",
      }),
      missingData: mc.slice(0, 8).map((n) => `${n} cost`),
    }));
  }

  if (!s.cash.hasLiveData && s.cash.latestCount.value == null) {
    out.push(finding({
      id: "cash-not-tracked", class: "data_quality",
      title: "Cash is not being tracked yet",
      detail: "No drawer counts, withdrawals or injections are recorded — the strategist cannot verify cash against profit until the first count.",
      evidence: [ev("Latest count", s.cash.latestCount), ev("Expected balance", s.cash.expectedBalance)],
      impactEgp: null, urgency: "this_week", confidence: "high",
      actionable: true,
      action: action({
        title: "Do the first cash count",
        action: "Count the drawer once on Money → Count cash; from then on differences become visible automatically.",
        rationale: "One count turns the whole cash module on.",
        screenLink: "/money", urgency: "this_week",
      }),
      missingData: ["first physical cash count"],
    }));
  }

  if (!s.inventory.hasLiveData) {
    out.push(finding({
      id: "inventory-not-tracked", class: "data_quality",
      title: "Inventory has no live data",
      detail: "No stock counts or purchases exist in the system — stock value, low-stock alerts and days-of-cover are silent.",
      evidence: [ev("Stock value", s.inventory.stockValue)],
      impactEgp: null, urgency: "this_month", confidence: "high",
      actionable: true,
      action: action({
        title: "Record an opening stock count",
        action: "Enter current shelf quantities in Settings → Opening balances (unknown costs post cost-neutral).",
        rationale: "Stock tracking starts working from the first count forward.",
        screenLink: "/settings/opening",
      }),
      missingData: ["opening stock count"],
    }));
  }

  if (s.meta.isStale && s.meta.staleDays != null) {
    out.push(finding({
      id: "stale-books", class: "data_quality",
      title: `Books are ${s.meta.staleDays} days behind`,
      detail: `The last recorded sale is ${s.meta.lastDataDate}. Every "current" number is really as of that date.`,
      evidence: [ev("Period revenue", s.revenue.periodRevenue)],
      impactEgp: null, urgency: "today", confidence: "high",
      resolutionCriteria: "last recorded sale within 3 days of today",
      alternativeAction: "If the shop was genuinely closed, record zero-days so the gap is explained.",
      actionable: true,
      action: action({
        title: "Bring the books current",
        action: `Enter the daily sales since ${s.meta.lastDataDate} (bulk totals importer takes a screenshot or CSV).`,
        rationale: "Stale books make every other insight conditional.",
        screenLink: "/sales/import", urgency: "today",
      }),
      missingData: [`daily sales after ${s.meta.lastDataDate}`],
    }));
  }

  return out;
}

/* ═══ 5. OPPORTUNITIES ════════════════════════════════════════════════ */

export function findOpportunities(s: StrategistSnapshot): Finding[] {
  const out: Finding[] = [];
  if (s.products.topRevenue.confidence === "none") return out;

  const hvlm = s.products.highVolumeLowMargin.value ?? [];
  if (hvlm.length && s.context.allowPriceRecommendations.value) {
    const p = hvlm[0];
    out.push(finding({
      id: "hvlm-pricing", class: "opportunity",
      title: `${p.name} sells in volume at below-median margin${p.marginPct != null ? ` (${pct(p.marginPct)})` : ""}`,
      detail: `${egp(p.revenue)} of period revenue. A small price or cost improvement here moves real money because the volume is already proven.`,
      evidence: [ev("High-volume low-margin", s.products.highVolumeLowMargin, (v) => (v as { name: string }[]).slice(0, 3).map((x) => x.name).join(", "))],
      impactEgp: Math.round(p.revenue * 0.03),
      urgency: "this_month", confidence: "medium",
      actionable: true,
      action: action({
        title: `Reprice or renegotiate ${p.name}`,
        action: `Test a small price increase on ${p.name} or negotiate its purchase cost — volume gives you leverage both ways.`,
        rationale: "Its demand is proven; its economics are the weak part.",
        expectedImpact: `~${egp(p.revenue * 0.03)} per period per 3 points of margin recovered`,
        screenLink: "/reports",
        caveats: ["weighted-goods demand can be price-sensitive — test, don't jump"],
      }),
      missingData: [],
    }));
  }

  const lvhm = s.products.lowVolumeHighMargin.value ?? [];
  if (lvhm.length) {
    const p = lvhm[0];
    out.push(finding({
      id: "lvhm-grow", class: "opportunity",
      title: `${p.name} earns ${p.marginPct != null ? pct(p.marginPct) : "a high"} margin but barely sells`,
      detail: `Only ${egp(p.revenue)} of period revenue. If visibility (placement, sampling) lifts its volume, each extra sale is unusually profitable.`,
      evidence: [ev("Low-volume high-margin", s.products.lowVolumeHighMargin, (v) => (v as { name: string }[]).slice(0, 3).map((x) => x.name).join(", "))],
      impactEgp: null, urgency: "this_month", confidence: "medium",
      actionable: true,
      action: action({
        title: `Give ${p.name} better placement`,
        action: `Move ${p.name} to eye level / near the scale for two weeks and watch its velocity.`,
        rationale: "High margin + low volume is usually a visibility problem before it's a demand problem.",
        screenLink: "/reports",
        caveats: ["two weeks minimum before judging — day-to-day noise is high"],
      }),
      missingData: [],
    }));
  }

  return out;
}

/* ═══ 6. RANKING ══════════════════════════════════════════════════════ */

const URGENCY_W: Record<Urgency, number> = { today: 1, this_week: 0.8, this_month: 0.55, monitor: 0.3 };
const CONF_W: Record<FindingConfidence, number> = { high: 1, medium: 0.75, low: 0.45 };
const CLASS_W: Record<Finding["class"], number> = {
  contradiction: 1, decision_risk: 0.95, warning: 0.9, data_quality: 0.75,
  opportunity: 0.7, recommendation: 0.65, forecast: 0.5, fact: 0.4,
};

/** Deterministic ranking: impact × urgency × confidence × class × actionability. */
export function rankFindings(findings: Finding[]): Finding[] {
  const maxImpact = Math.max(1, ...findings.map((f) => f.impactEgp ?? 0));
  const scored = findings.map((f) => ({
    ...f,
    persistEligible: shouldPersistFinding(f),
    score: Math.round(1000 * (
      (0.40 * ((f.impactEgp ?? maxImpact * 0.15) / maxImpact)) +
      (0.25 * URGENCY_W[f.urgency]) +
      (0.15 * CONF_W[f.confidence]) +
      (0.10 * CLASS_W[f.class]) +
      (0.10 * (f.actionable ? 1 : 0.3))
    )) ,
  }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.map((f, i) => ({ ...f, rank: i + 1 }));
}

/* ═══ THE PIPELINE ════════════════════════════════════════════════════ */

export function analyzeSnapshot(s: StrategistSnapshot, extraFindings: Finding[] = []): Finding[] {
  const found = [
    ...detectChanges(s),
    ...findDrivers(s),
    ...findContradictions(s),
    ...dataQualityFindings(s),
    ...findOpportunities(s),
    ...extraFindings,
  ];
  if (found.length === 0) {
    found.push(finding({
      id: "steady-state", class: "fact",
      title: "No meaningful change detected",
      detail: "Revenue, margin, expenses and settlements are all inside normal ranges for the period.",
      evidence: [ev("Period revenue", s.revenue.periodRevenue)],
      impactEgp: null, urgency: "monitor", confidence: "medium",
      actionable: false, action: null, missingData: [],
    }));
  }
  return rankFindings(found);
}
