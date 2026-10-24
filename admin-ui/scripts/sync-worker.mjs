// Regenerates the embedded asset map in src/index.js from public/index.html, public/app.js and public/styles.css.
// Usage (from admin-ui/): node scripts/sync-worker.mjs        -> rewrite src/index.js
//                         node scripts/sync-worker.mjs --check -> exit 1 if src/index.js is out of date
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const html = read("public/index.html");
const entries = [["/", html], ["/index.html", html], ["/app.js", read("public/app.js")], ["/styles.css", read("public/styles.css")]];
const block = "const FILES = new Map([\n" + entries.map(([k, v]) => `  [${JSON.stringify(k)}, ${JSON.stringify(v)}],`).join("\n") + "\n]);";
const current = read("src/index.js");
const next = current.replace(/const FILES = new Map\(\[\n[\s\S]*?\n\]\);/, () => block);
if (process.argv.includes("--check")) {
  if (next !== current) { console.error("admin-ui/src/index.js is out of sync with public/. Run: node scripts/sync-worker.mjs"); process.exit(1); }
  console.log("admin-ui/src/index.js is in sync with public/.");
} else {
  writeFileSync(new URL("src/index.js", root), next);
  console.log("admin-ui/src/index.js updated", next.length, "chars");
}
