// Data export: pulls every bvas_devices_<state> table via the Supabase REST API
// into a single JSON backup file.
//
// Usage (from repo root):
//   BVAS_SESSION_ID=<session UUID> node scripts/export_data.js
//
// By default it reads SUPABASE_URL and SUPABASE_ANON_KEY from index.html.
// You can override them with environment variables, e.g.:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... BVAS_SESSION_ID=... node scripts/export_data.js
//
// The anon key is public-by-design; output is a read-only backup.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function grab(pattern) {
  const m = html.match(pattern);
  if (!m) throw new Error("Could not find " + pattern + " in index.html");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = (process.env.SUPABASE_URL || grab(/const SUPABASE_URL = "([^"]*)"/)).replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || grab(/const SUPABASE_ANON_KEY = "([^"]*)"/);
const SESSION_ID = process.env.BVAS_SESSION_ID;
if (!SESSION_ID) throw new Error("Set BVAS_SESSION_ID to the browser session you want to export");

const statesMatch = html.match(/const STATES = \[([\s\S]*?)\];/);
if (!statesMatch) throw new Error("STATES array not found in index.html");
const STATES = JSON.parse("[" + statesMatch[1] + "]");
const tables = STATES.map((s) => "bvas_devices_" + s.toLowerCase().replace(/\s+/g, "_"));

const headers = {
  apikey: ANON_KEY,
  Authorization: "Bearer " + ANON_KEY,
  Accept: "application/json",
  "X-BVAS-Session": SESSION_ID,
};

async function fetchTable(table) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?select=*&order=ts.asc", { headers });
  if (res.status === 404) return { table, status: 404, rows: null };
  if (!res.ok) throw new Error(table + " -> HTTP " + res.status);
  const rows = await res.json();
  return { table, status: 200, rows: Array.isArray(rows) ? rows : [] };
}

(async function () {
  console.log("Exporting from " + SUPABASE_URL + " (" + tables.length + " tables) ...");
  const results = [];
  const missing = [];
  let total = 0;
  for (const table of tables) {
    const r = await fetchTable(table);
    results.push(r);
    if (r.status === 404) { missing.push(table); continue; }
    total += r.rows.length;
    process.stdout.write("  " + table + ": " + r.rows.length + " rows\n");
  }

  const backup = {
    exported_at: new Date().toISOString(),
    schema_version: "0001+0002+0003",
    session_scoped: true,
    url: SUPABASE_URL,
    total_rows: total,
    tables: {},
  };
  for (const r of results) if (r.status === 200) backup.tables[r.table] = r.rows;
  if (missing.length) backup.missing_tables = missing;

  const name = "bvas-db-export-" + new Date().toISOString().slice(0, 10) + ".json";
  const out = path.join(ROOT, name);
  fs.writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log("\nWrote " + out + " (" + total + " rows)" + (missing.length ? "\nMissing tables (run migrations 0001+0002+0003): " + missing.join(", ") : ""));
})().catch((e) => { console.error("Export failed: " + e.message); process.exit(1); });