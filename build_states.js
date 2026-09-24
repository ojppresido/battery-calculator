const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

const m = html.match(/const STATES = \[([\s\S]*?)\];/);
if (!m) throw new Error("STATES array not found in index.html");
const states = JSON.parse("[" + m[1] + "]");

function slug(s) {
  return String(s).toLowerCase().replace(/\s+/g, "-");
}

let made = 0;
const slugs = states.map(slug);
for (const s of states) {
  const dir = path.join(ROOT, slug(s));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.writeFileSync(path.join(dir, "styles.css"), css);
  made++;
}

// Prune generated state dirs that are no longer in the STATES list.
for (const name of fs.readdirSync(ROOT)) {
  if (slugs.includes(name)) continue;
  const dir = path.join(ROOT, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (!/^[a-z0-9-]+$/.test(name)) continue;
  const ih = path.join(dir, "index.html");
  const cs = path.join(dir, "styles.css");
  if (!fs.existsSync(ih) || !fs.existsSync(cs)) continue;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Removed stale dir: " + name);
}

console.log("Generated " + made + " per-state directories: " + slugs.join(", "));