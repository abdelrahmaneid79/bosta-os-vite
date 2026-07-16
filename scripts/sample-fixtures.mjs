// Sample ~one real POS day-report screenshot per ISO week from the owner's local
// archive into a git-ignored regression-fixture folder, and write a committed
// manifest (dates + metadata only, no image bytes). The receipt date is taken
// from the filename (D-M-YY), which is the free ground truth for date accuracy.
//
//   node scripts/sample-fixtures.mjs [--src "<folder>"] [--per week|month]
//
// Default source: the "Bosta Bites daily sales 2" archive in Downloads.
import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const SRC = argVal("--src", join(homedir(), "Downloads", "Bosta Bites daily sales 2"));
const PER = argVal("--per", "week"); // one fixture per ISO week (default) or per month
const OUT = join(process.cwd(), "fixtures", "day-reports");

/** Recursively collect image files under a directory. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(png|jpe?g|webp|heic)$/i.test(name)) out.push(p);
  }
  return out;
}

/** Parse the trading date out of a filename like "16-9-25.PNG" or
 *  "01-11-24 sales.PNG" → ISO "2025-09-16". Returns null when it doesn't fit. */
function dateFromName(file) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})\b/.exec(basename(file));
  if (!m) return null;
  const [, d, mo, yy] = m;
  const day = Number(d), mon = Number(mo), year = 2000 + Number(yy);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ISO week key "YYYY-Www" for grouping. */
function weekKey(iso) {
  const dt = new Date(iso + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - day + 3); // nearest Thursday
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const groupKey = (iso) => (PER === "month" ? iso.slice(0, 7) : weekKey(iso));

let files;
try { files = walk(SRC); }
catch { console.error(`Source folder not found: ${SRC}\nPass --src "<folder>".`); process.exit(1); }

// Keep the earliest-dated readable image in each group.
const chosen = new Map(); // groupKey -> {iso, path}
let skipped = 0;
for (const f of files) {
  const iso = dateFromName(f);
  if (!iso) { skipped++; continue; }
  const k = groupKey(iso);
  const cur = chosen.get(k);
  if (!cur || iso < cur.iso) chosen.set(k, { iso, path: f });
}

mkdirSync(OUT, { recursive: true });
const manifest = [];
for (const { iso, path } of [...chosen.values()].sort((a, b) => a.iso.localeCompare(b.iso))) {
  const ext = extname(path).toLowerCase();
  const dest = `${iso}${ext}`;
  copyFileSync(path, join(OUT, dest));
  // template variant guess by year: 2024 archive has no barcode column.
  const variant = iso < "2025-01-01" ? "v2024_no_barcode" : "v2025_barcode";
  manifest.push({ file: dest, date: iso, variantGuess: variant, source: basename(path) });
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Scanned ${files.length} image(s), skipped ${skipped} unparseable name(s).`);
console.log(`Sampled ${manifest.length} fixture(s) (one per ${PER}) → fixtures/day-reports/`);
console.log(`Date range: ${manifest[0]?.date} … ${manifest.at(-1)?.date}`);
