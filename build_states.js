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
for (const s of states) {
  const dir = path.join(ROOT, slug(s));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.writeFileSync(path.join(dir, "styles.css"), css);
  made++;
}
console.log("Generated " + made + " per-state directories: " + states.map(slug).join(", "));