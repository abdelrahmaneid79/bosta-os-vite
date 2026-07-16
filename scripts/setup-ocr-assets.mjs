// Provision the self-hosted local-OCR assets into public/ocr/ so OCR never hits
// a CDN at runtime (offline requirement). Copies the Tesseract worker + wasm core
// from node_modules and ensures the ara+eng language data is present (downloading
// once from the open tessdata mirror only if missing — a build-time step, never
// at runtime on the user's device). Idempotent; run by prebuild/predev.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/ocr");
const LANG = resolve(OUT, "lang");
mkdirSync(LANG, { recursive: true });

import { readdirSync } from "node:fs";
// Tesseract worker + the FULL core file set (the loader importScripts the
// `<core>.wasm.js` emscripten glue, which pulls the matching `.wasm`).
copyFileSync(resolve(ROOT, "node_modules/tesseract.js/dist/worker.min.js"), resolve(OUT, "worker.min.js"));
const CORE = resolve(ROOT, "node_modules/tesseract.js-core");
if (existsSync(CORE)) {
  for (const f of readdirSync(CORE)) {
    if (!/^tesseract-core.*\.(js|wasm)$/.test(f)) continue;
    const from = resolve(CORE, f), to = resolve(OUT, f);
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
  }
} else console.warn("  missing tesseract.js-core — run npm install");

const LANGS = ["eng", "ara"];
const MIRROR = "https://cdn.jsdelivr.net/npm/@tesseract.js-data";
let missing = [];
for (const l of LANGS) {
  const f = resolve(LANG, `${l}.traineddata.gz`);
  if (existsSync(f) && statSync(f).size > 100000) continue;
  try {
    const res = await fetch(`${MIRROR}/${l}/4.0.0_best_int/${l}.traineddata.gz`);
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    const { writeFileSync } = await import("node:fs");
    writeFileSync(f, buf);
  } catch (e) { missing.push(`${l} (${e.message})`); }
}

console.log("OCR assets ready in public/ocr/" + (missing.length ? `\n  ⚠ could not fetch lang data: ${missing.join(", ")} — provide public/ocr/lang/*.traineddata.gz manually` : ""));
