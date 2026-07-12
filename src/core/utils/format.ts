/** Display formatters. Pure — safe to use anywhere. */

export function egp(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  // round to 2 dp, but drop trailing zeros so whole amounts stay clean (1,562 not 1,562.00)
  return "EGP " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Compact money: 1.52M / 541K / 980. */
export function egpShort(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "EGP " + trim(n / 1_000_000) + "M";
  if (abs >= 1_000) return "EGP " + trim(n / 1_000) + "K";
  return "EGP " + Math.round(n);
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits) + "%";
}

/** Quantities/units: up to 3 dp, trailing zeros dropped. Integer counts (rows,
 *  product totals) stay clean since trailing zeros are trimmed. */
export function num(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function signed(n: number, fmt: (x: number) => string = egp): string {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
}

/** egpShort without the currency prefix — for tiles that render "EGP" separately. */
export const egpShortBare = (n: number | null | undefined): string => egpShort(n).replace("EGP ", "");
