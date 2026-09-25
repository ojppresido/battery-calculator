const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no script found");

const pageScript = m[1];

const elCache = new Map();

function makeEl(id) {
  if (elCache.has(id)) return elCache.get(id);
  const listeners = {};
  const el = {
    id,
    _inner: "",
    _text: "",
    value: "",
    checked: false,
    disabled: false,
    className: "",
    title: "",
    href: "",
    download: "",
    dataset: {},
    focus() {},
    scrollIntoView() {},
    remove() {},
    click() { this._fire("click", {}); },
    appendChild() {},
    getAttribute() { return null; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    _fire(ev, e) {
      const evs = listeners[ev] || [];
      for (const fn of evs) fn(e || { preventDefault() {} });
    },
    querySelectorAll() { return []; },
    get innerHTML() { return this._inner; },
    set innerHTML(v) { this._inner = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    classList: {
      add(...cs) { _cls(el, cs, true); },
      remove(...cs) { _cls(el, cs, false); },
      toggle(c, force) {
        const has = (el.className || "").split(/\s+/).includes(c);
        const want = force === undefined ? !has : !!force;
        if (want) _cls(el, [c], true); else _cls(el, [c], false);
      },
      contains(c) { return (el.className || "").split(/\s+/).includes(c); },
    },
  };
  elCache.set(id, el);
  return el;
}

function _cls(el, cs, add) {
  const set = new Set((el.className || "").split(/\s+/).filter(Boolean));
  for (const c of cs) { if (add) set.add(c); else set.delete(c); }
  el.className = [...set].join(" ");
}

const docListeners = {};
const document = {
  getElementById: makeEl,
  createElement: () => makeEl("_created_" + Math.random()),
  body: { appendChild() {} },
  addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
};

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const sessionStore = {};
const sessionStorage = {
  getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
  setItem: (k, v) => { sessionStore[k] = String(v); },
  removeItem: (k) => { delete sessionStore[k]; },
};

const context = {
  console,
  document,
  localStorage,
  sessionStorage,
  window: { location: { search: "", pathname: "/ogun/" }, print() {} },
  URLSearchParams,
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  Blob: function () {},
  confirm: () => true,
  setTimeout,
  clearTimeout,
};

vm.createContext(context);

try {
  vm.runInContext(pageScript, context, { filename: "page.js" });
} catch (e) {
  console.log("SCRIPT ERROR:", e.stack);
  process.exit(1);
}

const driver = `
  function t(name, cond, extra) {
    var tag = cond ? "PASS" : "FAIL";
    console.log(tag + ": " + name + (cond ? "" : (extra ? "  [" + extra + "]" : "")));
    if (!cond) context_test_failed = true;
  }
  var context_test_failed = false;

  COMPONENTS.forEach(function (c) { compInput(c.key).checked = true; });

  document.getElementById("simType").value = "MTN";
  document.getElementById("deviceId").value = "101701";
  saveDevice();
  t("device saved", devices.length === 1);
  t("battery pending before test", devices[0].batteryOk === null);
  t("simType saved", devices[0].simType === "MTN", devices[0].simType);

  /* Device ID must be strict: exactly NNN-NNN */
  var beforeStrict = devices.length;
  document.getElementById("deviceId").value = "345";
  document.getElementById("simType").value = "MTN";
  saveDevice();
  t("short device id rejected", devices.length === beforeStrict, "before=" + beforeStrict + " after=" + devices.length);
  t("short device id error shown", els.formMsg.className.indexOf("text-red-700") !== -1, els.formMsg.className);
  document.getElementById("deviceId").value = "1017010";
  saveDevice();
  t("too-long device id rejected", devices.length === beforeStrict, "before=" + beforeStrict + " after=" + devices.length);
  document.getElementById("deviceId").value = "abc101701xyz";
  saveDevice();
  t("device id with letters rejected", devices.length === beforeStrict, "before=" + beforeStrict + " after=" + devices.length);
  document.getElementById("deviceId").value = "101-70";
  saveDevice();
  t("incomplete device id rejected", devices.length === beforeStrict, "before=" + beforeStrict + " after=" + devices.length);

  /* SIM Type is required */
  document.getElementById("deviceId").value = "303303";
  document.getElementById("simType").value = "";
  saveDevice();
  t("missing sim type rejected", devices.length === beforeStrict, "before=" + beforeStrict + " after=" + devices.length);
  t("missing sim type error shown", els.formMsg.className.indexOf("text-red-700") !== -1, els.formMsg.className);

  /* battery endurance inputs must clear after a successful save */
  document.getElementById("consumed").value = "500";
  document.getElementById("minutes").value = "45";
  document.getElementById("simType").value = "GLO";
  document.getElementById("deviceId").value = "404404";
  saveDevice();
  t("second device saved", devices.length === beforeStrict + 1);
  t("consumed cleared after save", document.getElementById("consumed").value === "", JSON.stringify(document.getElementById("consumed").value));
  t("minutes cleared after save", document.getElementById("minutes").value === "", JSON.stringify(document.getElementById("minutes").value));
  t("simType reset to placeholder after save", document.getElementById("simType").value === "", JSON.stringify(document.getElementById("simType").value));
  t("deviceId cleared after save", document.getElementById("deviceId").value === "", JSON.stringify(document.getElementById("deviceId").value));

  /* bad-battery retest: attach must happen IMMEDIATELY at runAssessment */
  startRetest("101-701");
  t("retest target set", retestTarget === "101-701");

  document.getElementById("consumed").value = "1000";
  document.getElementById("minutes").value = "30";
  runAssessment();
  t("pending set", !!pending || retestTarget === null);
  t("bad result accepted immediately (batteryOk === false)", devices[0].batteryOk === false);
  t("battery hours recorded even when low (score kept)", typeof devices[0].hours === "number" && devices[0].hours < 7, devices[0].hours);
  t("bad result accepted even with pending cleared", devices[0].batteryOk === false && pending === null);
  t("status = BATTERY REPLACEMENT REQUIRED", devices[0].status === "BATTERY REPLACEMENT REQUIRED");
  t("modal target line visible", document.getElementById("mTarget") && document.getElementById("mTarget").className.indexOf("hidden") === -1);
  t("modal shows the score", document.getElementById("mLifeHours").textContent !== "\u2014");

  closeModal();
  t("no double attach on close", devices[0].batteryOk === false && devices[0].hours < 7);
  t("retestTarget cleared after accept", retestTarget === null);

  var cell = batteryCell(devices[0]);
  t("table cell shows score for bad battery", cell.indexOf("h") !== -1 && cell.indexOf("pending") === -1, cell);

  /* good-battery retest still auto-accepts */
  startRetest("101-701");
  document.getElementById("consumed").value = "100";
  document.getElementById("minutes").value = "60";
  runAssessment();
  t("good battery auto-accepted (batteryOk === true)", devices[0].batteryOk === true);

  /* SIM Slot must NOT affect functionality */
  COMPONENTS.forEach(function (c) { compInput(c.key).checked = true; });
  compInput("sim").checked = false;
  document.getElementById("deviceId").value = "202202";
  document.getElementById("simType").value = "GLO";
  document.getElementById("consumed").value = "100";
  document.getElementById("minutes").value = "60";
  runAssessment();
  saveDevice();
  var d2 = devices.find(function (d) { return d.deviceId === "202-202"; });
  t("SIM unticked + rest OK + good battery -> FUNCTIONAL", !!d2 && d2.status === "FUNCTIONAL", d2 && d2.status);
  t("SIM unticked recorded on device", d2 && d2.comp.sim === false);

  compInput("screen").checked = false;
  document.getElementById("deviceId").value = "303303";
  document.getElementById("simType").value = "MTN";
  saveDevice();
  var d3 = devices.find(function (d) { return d.deviceId === "303-303"; });
  t("screen unticked -> NON-FUNCTIONAL (gate still works)", !!d3 && d3.status === "NON-FUNCTIONAL", d3 && d3.status);

  /* duplicate device ID must be rejected, not saved */
  var before = devices.length;
  document.getElementById("deviceId").value = "101701";
  document.getElementById("simType").value = "MTN";
  document.getElementById("consumed").value = "100";
  document.getElementById("minutes").value = "60";
  runAssessment();
  saveDevice();
  t("duplicate rejected: count unchanged", devices.length === before, "before=" + before + " after=" + devices.length);
  t("duplicate rejected: error shown", els.formMsg.className.indexOf("text-red-700") !== -1, els.formMsg.className);

  console.log(context_test_failed ? "RESULT: FAILURES" : "RESULT: ALL PASS");
`;

vm.runInContext(driver, context, { filename: "driver.js" });