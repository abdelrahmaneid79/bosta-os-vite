/** Display formatters. Pure — safe to use anywhere. */

export function egp(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "EGP " + Math.round(n).toLocaleString("en-US");
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

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function signed(n: number, fmt: (x: number) => string = egp): string {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
}
