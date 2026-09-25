const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no script");
const pageScript = m[1];

const elCache = new Map();
function makeEl(id) {
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

const docListeners = {};
const document = { getElementById: makeEl, createElement: () => makeEl("_x"), body: { appendChild() {} }, addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); } };

const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const sessionStore = {};
const sessionStorage = { getItem: (k) => (k in sessionStore ? sessionStore[k] : null), setItem: (k, v) => { sessionStore[k] = String(v); }, removeItem: (k) => { delete sessionStore[k]; } };

const calls = [];
const fakeRows = [
  { id: 1, row_id: "00000000-0000-4000-8000-000000000001", device_id: "OG-0421", ts: 1, sim_type: "MTN", state: "OGUN", screen: true, camera: true, fingerprint: true, sim: true, charging: true, wifi: true, gps: true, battery_ok: true, battery_hours: 9.86, status: "FUNCTIONAL", remarks: "" },
  { id: 2, row_id: "00000000-0000-4000-8000-000000000002", device_id: "OG-0423", ts: 2, sim_type: "GLO", state: "OGUN", screen: true, camera: true, fingerprint: true, sim: true, charging: true, wifi: true, gps: true, battery_ok: false, battery_hours: 3.68, status: "BATTERY REPLACEMENT REQUIRED", remarks: "Battery replacement required" }
];

async function mockFetch(url, opts) {
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url, method, body: opts && opts.body, headers: opts && opts.headers });
  const json = async () => {
    if (url.includes("select=*")) return fakeRows;
    if (method === "POST" && body) return body.map((row) => Object.assign({ id: 99 }, row));
    return [];
  };
  return { ok: true, status: 200, json };
}

const windowObj = { location: { search: "", pathname: "/ogun/" }, print() {} };
const context = { console, document, localStorage, sessionStorage, window: windowObj, fetch: mockFetch, calls, URLSearchParams, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} }, Blob: function () {}, confirm: () => true, setTimeout, clearTimeout };
vm.createContext(context);

try { vm.runInContext(pageScript, context, { filename: "page.js" }); }
catch (e) { console.log("SCRIPT ERROR:", e.stack); process.exit(1); }

const driver = `
  function t(name, cond, extra) { var tag = cond ? "PASS" : "FAIL"; console.log(tag + ": " + name + (cond ? "" : (extra ? "  [" + extra + "]" : ""))); if (!cond) __fail = true; }
  var __fail = false;

  t("db enabled from ?state=ogun", DB.enabled === true);
  t("table = bvas_devices_ogun", DB.table === "bvas_devices_ogun", DB.table);
  t("lock active", LOCKED_STATE === "OGUN");
  t("storage key is per-state and session", storageKey() === "bvas_inventory_v3_OGUN_" + SESSION_ID, storageKey());
  t("session id is stored", sessionStorage.getItem("bvas_session_v1") === SESSION_ID, sessionStorage.getItem("bvas_session_v1"));

  (async function () {
    await loadFromDb();
    t("loaded 2 devices from db", devices.length === 2, "got " + devices.length);
    t("device row mapped (bad battery score kept)", devices[1].deviceId === "OG-0423" && devices[1].batteryOk === false && devices[1].hours === 3.68);
    t("status normalized", devices[1].status === "BATTERY REPLACEMENT REQUIRED");
    t("status pill shows Online", els.statusPill && els.statusText.textContent.indexOf("Online") !== -1, els.statusText && els.statusText.textContent);
    t("status dot is green", els.statusDot && els.statusDot.className.indexOf("green") !== -1, els.statusDot && els.statusDot.className);
    t("database requests carry private session header", calls.every(function (c) { return c.headers && c.headers["X-BVAS-Session"] === SESSION_ID; }));
    t("row actions expose edit", els.inventoryBody.innerHTML.indexOf('data-act="edit"') !== -1);
    editingRowId = devices[0].rowId;
    renderTable();
    t("edit mode renders editable fields", els.inventoryBody.innerHTML.indexOf('data-edit-field="deviceId"') !== -1 && els.inventoryBody.innerHTML.indexOf('data-edit-comp="screen"') !== -1);
    editingRowId = null;
    renderTable();

    document.getElementById("deviceId").value = "701100";
    document.getElementById("simType").value = "MTN";
    COMPONENTS.forEach(function (c) { compInput(c.key).checked = true; });
    document.getElementById("consumed").value = "1000";
    document.getElementById("minutes").value = "30";
    runAssessment();
    await saveDevice();

    var up = calls.filter(function (c) { return c.method === "POST" && c.url.indexOf("on_conflict=row_id") !== -1; });
    t("saveDevice upserted to db", up.length === 1);
    t("upsert hits bvas_devices_ogun", up[0].url.indexOf("/bvas_devices_ogun?") !== -1, up[0].url);
    var row = JSON.parse(up[0].body)[0];
    t("upsert maps deviceId", row.device_id === "701-100", row.device_id);
    t("upsert carries stable row id", typeof row.row_id === "string" && row.row_id.length > 0);
    t("upsert keeps battery score", row.battery_ok === false && row.battery_hours < 7, JSON.stringify(row));
    t("upsert sends selected sim type", row.sim_type === "MTN", row.sim_type);
    t("battery inputs cleared after save", document.getElementById("consumed").value === "" && document.getElementById("minutes").value === "", document.getElementById("consumed").value + "/" + document.getElementById("minutes").value);
    t("simType reset after save", document.getElementById("simType").value === "", document.getElementById("simType").value);

    var edited = devices[0];
    function editRowStub(idValue, simValue) {
      return {
        querySelector: function (selector) {
          var fields = {
            '[data-edit-field="deviceId"]': { value: idValue },
            '[data-edit-field="simType"]': { value: simValue },
            '[data-edit-field="batteryOk"]': { value: "true" },
            '[data-edit-field="hours"]': { value: "8.5" },
            '[data-edit-field="remarks"]': { value: "Corrected during review" }
          };
          if (fields[selector]) return fields[selector];
          var comp = selector.match(/data-edit-comp="([^"]+)"/);
          return comp ? { checked: true } : null;
        }
      };
    }

    var originalId = edited.deviceId;
    await saveEditedRow(edited, editRowStub("0424", "GLO"));
    t("edited row rejects invalid device id", edited.deviceId === originalId, edited.deviceId);
    await saveEditedRow(edited, editRowStub("042400", ""));
    t("edited row rejects missing sim type", edited.deviceId === originalId && edited.simType === "MTN", edited.deviceId + "/" + edited.simType);

    await saveEditedRow(edited, editRowStub("042400", "GLO"));
    t("edited row updates device id", edited.deviceId === "042-400", edited.deviceId);
    t("edited row updates sim type", edited.simType === "GLO", edited.simType);
    t("edited row updates status and battery", edited.batteryOk === true && edited.hours === 8.5 && edited.status === "FUNCTIONAL", edited.status);

    var deleteCallsBeforeClear = calls.filter(function (c) { return c.method === "DELETE"; }).length;
    document.getElementById("clearBtn").click();
    t("clear all is local-only", devices.length === 0 && calls.filter(function (c) { return c.method === "DELETE"; }).length === deleteCallsBeforeClear);
    t("clear all removes local snapshot", JSON.parse(localStorage.getItem(storageKey())).devices.length === 0);
  })().then(function () {
    console.log(__fail ? "RESULT: FAILURES" : "RESULT: ALL PASS");
  }).catch(function (e) { console.log("DRIVER ERROR:", e.stack); });
`;
vm.runInContext(driver, context, { filename: "driver.js" });