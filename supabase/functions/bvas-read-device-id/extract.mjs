/* =========================================================
   BVAS — reading a Device ID out of a model's answer
   ---------------------------------------------------------
   Pure functions, no platform APIs, so the edge function (Deno)
   and the Node test run exactly the same rules.

   A Device ID is always NNN-NNN: three digits, a hyphen, three
   digits. Everything here exists to accept that and nothing else.
   Dates (2024-05-12), phone numbers and longer serials are the
   things most likely to be mistaken for one, so a candidate is
   only accepted when it is six digits on its own — never a
   six-digit window cut out of something longer.
   ========================================================= */

/* Glyphs a model may hand back instead of a digit. */
const CONFUSABLE = {
  O: "0", o: "0", Q: "0", D: "0",
  S: "5", s: "5", B: "8",
  Z: "2", z: "2", A: "4", G: "6", T: "7", L: "1", I: "1",
  U: "0", u: "0", b: "6", g: "9", q: "9"
};

/* What may stand in for the hyphen inside one token. */
const INNER = "-‐‑‒–—―_/\\.:,|~ ";
const isDigit = (ch) => ch >= "0" && ch <= "9";

export function isDeviceId(value) {
  return /^[0-9]{3}-[0-9]{3}$/.test(String(value == null ? "" : value).trim());
}

/* Split a token into runs of digits and separators. A letter only counts as a
   digit when it sits directly between two of them, so "1O1" is read as 101
   while the brand name in "INEC/ZT/245-239" is a wall that ends the run rather
   than six digits of its own. Any other letter ends the run too. */
function runsInToken(token) {
  const runs = [];
  let current = "";
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (isDigit(ch)) { current += ch; continue; }
    const swap = CONFUSABLE[ch];
    if (swap != null && isDigit(token[i - 1] || "") && isDigit(token[i + 1] || "")) {
      current += swap;
      continue;
    }
    if (INNER.indexOf(ch) >= 0) { if (current) current += ch; continue; }
    if (current) { runs.push(current); current = ""; }
  }
  if (current) runs.push(current);
  return runs;
}

function idsInToken(token) {
  const ids = [];
  for (const run of runsInToken(token)) {
    const s = run.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "");
    if (!s) continue;
    const digits = s.replace(/[^0-9]/g, "");
    if (digits.length !== 6) continue;
    ids.push(digits.slice(0, 3) + "-" + digits.slice(3));
  }
  return ids;
}

export function findDeviceIds(text) {
  const src = String(text == null ? "" : text);
  const found = [];
  const seen = new Set();

  const add = (id, at, raw) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    found.push({ id, at, raw });
  };

  /* "245-239", "245239", "245.239", "1O1-7O1", "INEC/ZT/245-239" */
  const tokens = src.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    const at = src.indexOf(tokens[i]);
    for (const id of idsInToken(tokens[i])) add(id, at, tokens[i]);
  }

  /* "245 239" split across two tokens. The characters either side have to
     not be digits, so this cannot slice six out of a longer number. */
  const pair = /([0-9]{3})[ \t]+([0-9]{3})/g;
  let match;
  while ((match = pair.exec(src)) !== null) {
    const at = match.index;
    const before = at > 0 ? src[at - 1] : "";
    const after = src[at + match[0].length] || "";
    if (isDigit(before) || isDigit(after)) continue;
    add(match[1] + "-" + match[2], at, match[0].replace(/\s+/g, " "));
  }

  found.sort((x, y) => x.at - y.at);
  return found;
}

/* Pull the reply apart. The model is asked for JSON, but a stray
   sentence around it should not lose an otherwise good reading. */
export function unpackReply(reply) {
  const text = String(reply == null ? "" : reply).trim();
  let stated = null;
  let raw = text;

  const take = (body) => {
    if (!body || typeof body !== "object") return false;
    if (isDeviceId(body.device_id)) stated = body.device_id.trim();
    if (typeof body.raw_text === "string" && body.raw_text) raw = body.raw_text;
    return true;
  };

  try {
    if (!take(JSON.parse(text))) { /* not a bare object */ }
  } catch (e) {
    const loose = text.match(/\{[\s\S]*\}/);
    if (loose) { try { take(JSON.parse(loose[0])); } catch (e2) { /* plain text after all */ } }
  }
  return { stated, raw };
}

/* The one place a reply becomes a Device ID. */
export function pickDeviceId(reply) {
  const { stated, raw } = unpackReply(reply);
  if (stated) return { id: stated, raw, from: "stated" };
  const inRaw = findDeviceIds(raw);
  if (inRaw.length) return { id: inRaw[0].id, raw, from: "text" };
  return { id: null, raw, from: "none" };
}
