const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no script");
const pageScript = m[1];

// Sections exist in the DOM on every page; calc-only hides them via the .calc-only CSS class.
const REMOVED_IDS = new Set();
const CALC_ONLY_MISSING_IDS = [
  "comp_screen", "comp_camera", "comp_fingerprint", "comp_sim",
  "comp_charging", "comp_wifi", "comp_gps"
];

const elCache = new Map();
function makeEl(id) {
  if (REMOVED_IDS.has(id)) return null;
  if (elCache.has(id)) return elCache.get(id);
  const listeners = {};
  const el = {
    id, _inner: "", _text: "", value: "", checked: false, disabled: false, className: "", title: "", href: "", download: "",
    focus() {}, scrollIntoView() {}, remove() {}, click() { this._fire("click", {}); }, appendChild() {},
    getAttribute() { return null; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    _fire(ev, e) { (listeners[ev] || []).forEach((fn) => fn(e || { preventDefault() {} })); },
    querySelectorAll() { return []; },
    get innerHTML() { return this._inner; }, set innerHTML(v) { this._inner = String(v); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    classList: {
      add(...cs) { cls(el, cs, true); }, remove(...cs) { cls(el, cs, false); },
      toggle(c, force) { const has = (el.className || "").split(/\s+/).includes(c); const want = force === undefined ? !has : !!force; if (want) cls(el, [c], true); else cls(el, [c], false); },
      contains(c) { return (el.className || "").split(/\s+/).includes(c); },
    },
  };
  elCache.set(id, el);
  return el;
}
function cls(el, cs, add) { const set = new Set((el.className || "").split(/\s+/).filter(Boolean)); for (const c of cs) { if (add) set.add(c); else set.delete(c); } el.className = [...set].join(" "); }

function freshSandbox(search, pathname) {
  const docListeners = {};
  const bodyStub = { appendChild() {}, className: "", classList: { add(...cs) { bodyStub.className = [...new Set((bodyStub.className + " " + cs.join(" ")).split(/\s+/).filter(Boolean))].join(" "); }, remove() {}, toggle() {}, contains(c) { return bodyStub.className.split(/\s+/).includes(c); } } };
  const document = { getElementById: makeEl, createElement: () => makeEl("_x"), body: bodyStub, addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); } };
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  elCache.clear();
  const context = {
    console, document, localStorage,
    window: { location: { search: search || "", pathname: pathname || "/" }, print() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => [] }),
    URLSearchParams,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Blob: function () {},
    confirm: () => true,
    setTimeout, clearTimeout,
  };
  vm.createContext(context);
  try { vm.runInContext(pageScript, context, { filename: "page.js" }); }
  catch (e) { context.__initError = e; }
  return context;
}

function caseCalcOnly(name, search, pathname) {
  CALC_ONLY_MISSING_IDS.forEach((id) => REMOVED_IDS.add(id));
  const ctx = freshSandbox(search, pathname);
  CALC_ONLY_MISSING_IDS.forEach((id) => REMOVED_IDS.delete(id));
  if (ctx.__initError) { console.log("FAIL init " + name + ": " + ctx.__initError.stack); return; }
  const r = vm.runInContext(`
    var ok = true;
    ok &= (LOCKED_STATE === null) && (CALC_ONLY === true);
    ok &= storageKey() === "bvas_inventory_v3";
    ok &= document.body.className.indexOf("calc-only") !== -1;
    ok &= els.finalStatus !== null && els.formMsg !== null;
    document.getElementById("consumed").value = "100";
    document.getElementById("minutes").value = "30";
    runAssessment();
    ok &= (pending && Math.round(pending.hours * 10) === 368);
    ok &= els.modal.className.indexOf("hidden") === -1;
    closeModal();
    ok &= els.mLifeHours.textContent !== "\u2014";
    ok &= devices.length === 0;
    ("RESULT:" + (ok ? "PASS" : "FAIL") + ":calc-only " + JSON.stringify(${JSON.stringify(name)}));
  `, ctx);
  console.log(String(r));
}

function caseFull(name, search, pathname, expectState, expectKey) {
  const ctx = freshSandbox(search, pathname);
  if (ctx.__initError) { console.log("FAIL init " + name + ": " + ctx.__initError.stack); return; }
  const r = vm.runInContext(`
    var ok = true;
    ok &= (LOCKED_STATE === ${JSON.stringify(expectState)}) && (CALC_ONLY === false);
    ok &= storageKey() === ${JSON.stringify(expectKey)};
    ok &= document.body.className.indexOf("calc-only") === -1;
    ok &= els.finalStatus !== null && els.formMsg !== null;
    ok &= els.fieldState.value === ${JSON.stringify(expectState)} && els.fieldState.disabled === true;
    ok &= els.checkGrid.innerHTML.indexOf("comp_") !== -1;
    ("RESULT:" + (ok ? "PASS" : "FAIL") + ":full " + JSON.stringify(${JSON.stringify(name)}));
  `, ctx);
  console.log(String(r));
}

console.log("=== /battery-calculator/states/ogun/ — full (new nested form, pages) ===");
caseFull("pages states/ogun", "", "/battery-calculator/states/ogun/", "OGUN", "bvas_inventory_v3_OGUN");
console.log("=== /states/kano/ — full (new nested form, lan) ===");
caseFull("lan states/kano", "", "/states/kano/", "KANO", "bvas_inventory_v3_KANO");
console.log("=== LAN root (/) — calculator only ===");
caseCalcOnly("lan root /", "", "/");
console.log("=== root Pages (/battery-calculator/) — calculator only ===");
caseCalcOnly("pages root /battery-calculator/", "", "/battery-calculator/");
console.log("=== FORBIDDEN: /battery-calculator/?state=ogun — must NOT reach ogun (ignored) ===");
caseCalcOnly("forbidden ?state=ogun", "?state=ogun", "/battery-calculator/");
console.log("=== /battery-calculator/ogun/ — full (pages) ===");
caseFull("pages ogun", "", "/battery-calculator/ogun/", "OGUN", "bvas_inventory_v3_OGUN");
console.log("=== /kano/ — full (lan) ===");
caseFull("lan kano", "", "/kano/", "KANO", "bvas_inventory_v3_KANO");
console.log("=== /battery-calculator/fct-abuja/ — full ===");
caseFull("pages fct-abuja", "", "/battery-calculator/fct-abuja/", "FCT ABUJA", "bvas_inventory_v3_FCT_ABUJA");
console.log("=== /ondo/ — full, real state present===");
caseFull("lan ondo", "", "/ondo/", "ONDO", "bvas_inventory_v3_ONDO");
console.log("=== /ogun/index.html — full (lan file form) ===");
caseFull("lan ogun index.html", "", "/ogun/index.html", "OGUN", "bvas_inventory_v3_OGUN");