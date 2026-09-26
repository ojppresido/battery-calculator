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
    setAttribute(name, value) { this["attr_" + name] = String(value); },
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
  // The OCR loader injects a <script> into <head>; fail it straight away so the
  // "no network" path is exercised without a 45s timeout.
  head: { appendChild(el) { if (el && typeof el.onerror === "function") el.onerror(); } },
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

const URLShim = class extends URL {};
URLShim.createObjectURL = () => "blob:x";
URLShim.revokeObjectURL = () => {};

const location = { href: "https://example.test/states/ogun/index.html", search: "", pathname: "/states/ogun/" };

const context = {
  console,
  document,
  localStorage,
  sessionStorage,
  location,
  window: { location, print() {} },
  URLSearchParams,
  URL: URLShim,
  Blob: function () {},
  AbortController: globalThis.AbortController,
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
`;

vm.runInContext(driver, context, { filename: "driver.js" });

/* ---- OCR: scanned text -> Device ID ---- */
const ocrDriver = `
  (function () {
    function x(name, expected, text) {
      var got = ocrExtractDeviceId(text).id;
      var ok = got === expected;
      console.log((ok ? "PASS" : "FAIL") + ": ocr " + name +
        (ok ? "" : "  [expected " + JSON.stringify(expected) + " got " + JSON.stringify(got) + "]"));
      if (!ok) context_test_failed = true;
    }

    x("plain 245-239", "245-239", "245-239");
    x("sticker text INEC/ZT/245-239", "245-239", "INEC/ZT/245-239");
    x("hyphen lost", "245-239", "245239");
    x("space instead of hyphen", "245-239", "245 239");
    x("tilde instead of hyphen", "245-239", "245~239");
    x("O read for 0 in 2O5-239", "205-239", "2O5-239");
    x("S read for 5", "245-239", "24S-Z39");
    x("A read for 4", "245-239", "2A5-Z39");
    x("stray glyph splits 3+3", "245-239", "245 & 239");
    x("leading noise dropped", "245-239", "### 245-239 ###");
    x("label text around the id", "245-239", "BVAS KITU 245-239 OK");
    x("extra digit in front", "245-239", "1245239");
    x("first of two ids wins", "245-239", "245-239 or 245-231");
    x("no six digits -> nothing", "", "SAMSUNG GALAXY");
    x("date alone is not a device id", "", "2024-05-12");
    x("letters that look like digits are not an id", "", "NO DIGITS HERE");
    x("empty text -> nothing", "", "");

    var dupes = ocrExtractDeviceId("245-239 245-239");
    t("repeated id reported once", dupes.id === "245-239" && dupes.others.length === 0, JSON.stringify(dupes));

    /* merge: the reading several passes agree on wins over one louder guess */
    var agree = ocrMerge([{ text: "245-239" }, { text: "245-239" }, { text: "245-231 or 245-239" }]);
    t("agreeing passes win", agree.id === "245-239" && agree.list[0].votes === 3, JSON.stringify(agree.list));
    var split = ocrMerge([{ text: "245-239" }, { text: "245-231" }]);
    t("a tie falls back to the better score", !!split.id, JSON.stringify(split.list));
    t("no readings at all", ocrMerge([{ text: "SAMSUNG" }, { text: "" }]).id === "");

    /* settle rule: stop early on one clean read, keep going when it is weak */
    var one = [{ id: "245-239", score: 100, votes: 1 }];
    t("a clean single read settles immediately", ocrSettled({ list: one }, 1) === true);
    var weak = [{ id: "245-239", score: 45, votes: 1 }];
    t("a weak read does not settle", ocrSettled({ list: weak }, 1) === false);
    t("two agreeing passes settle", ocrSettled({ list: [{ id: "245-239", score: 45, votes: 2 }] }, 2) === true);
    var rivals = [{ id: "245-239", score: 80, votes: 1 }, { id: "245-231", score: 75, votes: 1 }];
    t("a close rival does not settle", ocrSettled({ list: rivals }, 2) === false);
    t("nothing read never settles", ocrSettled({ list: [] }, 5) === false);

    /* Otsu must split a bimodal image at the ink, not in the middle of the paper */
    var half = new Uint8Array(100);
    for (var i = 0; i < 50; i++) half[i] = 20;
    for (var j = 50; j < 100; j++) half[j] = 230;
    t("otsu puts the ink on the black side of the cut", ocrOtsu(half) >= 20 && ocrOtsu(half) < 230, String(ocrOtsu(half)));
    t("otsu survives a flat image", typeof ocrOtsu(new Uint8Array(100)) === "number");

    /* the pass plan: cheap-and-likely first, and every rotation is covered */
    t("first pass needs no rotation", OCR_PASSES[0].rot === 0 && OCR_PASSES[0].bin === "otsu");
    var rots = {};
    for (var q = 0; q < OCR_PASSES.length; q++) rots[OCR_PASSES[q].rot] = true;
    t("upright and both sideways are all tried", rots[0] && rots[90] && rots[180] && rots[270], JSON.stringify(Object.keys(rots)));
    var bins = {};
    for (var q2 = 0; q2 < OCR_PASSES.length; q2++) bins[OCR_PASSES[q2].bin] = true;
    t("more than one way of cleaning the image is tried", bins.otsu && bins.fixed && bins.none, JSON.stringify(Object.keys(bins)));
    t("a clean photo is never scaled past the pixel count it has", OCR_MAX_EDGE >= 2000 && OCR_MIN_EDGE < OCR_MAX_EDGE);

    /* a barcode is already an exact reading, so it is tried before the slow path */
    var barcodeTests = (function () {
      var seenFormats = null;
      globalThis.BarcodeDetector = function (opts) { seenFormats = opts.formats; this.detect = function () { return Promise.resolve([{ rawValue: "INEC/ZT/808-432" }]); }; };
      globalThis.BarcodeDetector.getSupportedFormats = function () { return Promise.resolve(["code_128", "qr_code"]); };
      var bitmapStub = { naturalWidth: 10, naturalHeight: 10 };
      return ocrFromBarcode(bitmapStub).then(function (fromBarcode) {
        t("device id read straight from a barcode", fromBarcode === "808-432", fromBarcode);
        t("barcode detector asked for the formats the phone supports", !!seenFormats && seenFormats.length === 2, JSON.stringify(seenFormats));
        globalThis.BarcodeDetector = function () { this.detect = function () { return Promise.resolve([{ rawValue: "ASSET-99120" }]); }; };
        globalThis.BarcodeDetector.getSupportedFormats = function () { return Promise.resolve(["code_128"]); };
        return ocrFromBarcode(bitmapStub);
      }).then(function (fromBarcode) {
        t("a barcode with no device id in it is ignored", fromBarcode === "", fromBarcode);
        delete globalThis.BarcodeDetector;
        return ocrFromBarcode(bitmapStub);
      }).then(function (afterRemoval) {
        t("a phone with no BarcodeDetector is handled", afterRemoval === "", afterRemoval);
        return ocrFromBarcode(null);
      }).then(function (withNothing) {
        t("no bitmap to scan is handled", withNothing === "", withNothing);
      });
    })();

    /* the phone's own text recogniser, where the browser has one */
    var platformTests = (function () {
      globalThis.TextDetector = function () {
        this.detect = function () { return Promise.resolve([{ rawValue: "INEC/ZT/245-239" }]); };
      };
      var read = ocrFromTextDetector({ naturalWidth: 10, naturalHeight: 10 });
      t("the phone's own text reader is used when present", read instanceof Promise);
      return read.then(function (id) {
        t("device id read with the phone's own text reader", id === "245-239", id);
        globalThis.TextDetector = undefined;
        return ocrFromTextDetector({ naturalWidth: 10, naturalHeight: 10 });
      }).then(function (afterRemoval) {
        t("a phone without a text reader falls through to the engine", afterRemoval === "", afterRemoval);
        return ocrFromTextDetector(null);
      }).then(function (withNothing) {
        t("no bitmap for the phone reader is handled", withNothing === "", withNothing);
      });
    })();
    t("a slow model download is bounded", OCR_LOAD_TIMEOUT > 10000 && OCR_LOAD_TIMEOUT < 300000, String(OCR_LOAD_TIMEOUT));
    t("the model ships with the app, not a third-party host", String(OCR_LANG_PATH).endsWith("/models"), OCR_LANG_PATH);
    t("a state page finds the model at the site root", OCR_LANG_PATH === "https://example.test/models", OCR_LANG_PATH);

    /* the crop box: aiming is the whole point, so it must stay reachable */
    cropState = { view: { w: 100, h: 50 }, rect: { x: 90, y: 45, w: 30, h: 20 } };
    ocrCropClamp();
    t("the crop box cannot be dragged off the photo",
      cropState.rect.x === 70 && cropState.rect.y + cropState.rect.h === 50, JSON.stringify(cropState.rect));
    cropState = { view: { w: 100, h: 50 }, rect: { x: 0, y: 0, w: 1, h: 1 } };
    ocrCropClamp();
    t("the crop box cannot shrink to nothing", cropState.rect.w === 24 && cropState.rect.h === 24, JSON.stringify(cropState.rect));
    cropState = { view: { w: 100, h: 50 }, rect: { x: -40, y: -40, w: 500, h: 500 } };
    ocrCropClamp();
    t("the crop box cannot grow past the photo",
      cropState.rect.w === 100 && cropState.rect.h === 50 && cropState.rect.x === 0 && cropState.rect.y === 0,
      JSON.stringify(cropState.rect));

    /* whatever the server says, only NNN-NNN may reach the box */
    var serverTests = (function () {
      var realFetch = globalThis.fetch;
      var sent = null;
      var reply = null;
      var status = 200;
      globalThis.fetch = function (url, opts) {
        sent = { url: String(url), body: JSON.parse(opts.body), headers: opts.headers };
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status: status,
          text: function () { return Promise.resolve(typeof reply === "string" ? reply : JSON.stringify(reply)); }
        });
      };
      t("the server read is offered on a state page", serverOcrAvailable() === true);
      var checks = [
        ["a good reading is taken", 200, { device_id: "245-239", confidence: "high" }, "245-239"],
        ["nothing readable comes back empty", 200, { device_id: null, raw_text: "no digits" }, ""],
        ["a truncated id is refused", 200, { device_id: "24-5239" }, null],
        ["an over-long id is refused", 200, { device_id: "245-2390" }, null],
        ["letters in the id are refused", 200, { device_id: "245-2X9" }, null],
        ["a date is refused", 200, { device_id: "2024-05-12" }, null],
        ["a missing field is refused", 200, { note: "hi" }, ""],
        ["a server error is refused", 500, { error: "boom" }, null],
        ["a non-JSON answer is refused", 200, "<html>oops</html>", null]
      ];
      var chain = Promise.resolve();
      checks.forEach(function (c) {
        chain = chain.then(function () {
          status = c[1];
          reply = c[2];
          return ocrReadOnServer("data:image/jpeg;base64,AAAA").then(function (out) {
            var got = out.id;
            t(c[0], c[3] === null ? false : got === c[3], JSON.stringify(got));
          }, function (e) {
            t(c[0], c[3] === null, "threw: " + e.message);
          });
        });
      });
      return chain.then(function () {
        t("the crop is posted as a JPEG data url",
          sent && sent.body.image.indexOf("data:image/jpeg;base64,") === 0, sent && sent.body.image.slice(0, 30));
        t("the function is called on the project's own host",
          sent && sent.url.endsWith("/functions/v1/" + SERVER_OCR.fn), sent && sent.url);
        t("the request carries the anon key",
          sent && sent.headers.apikey === SUPABASE_ANON_KEY && sent.headers.Authorization === "Bearer " + SUPABASE_ANON_KEY,
          sent && String(sent.headers.Authorization).slice(0, 20));
        globalThis.fetch = realFetch;
      });
    })();

    var idEl = document.getElementById("deviceId");
    var msg = function () { return document.getElementById("scanMsg").textContent; };

    /* scan flow: engine stubbed, no real Tesseract / canvas in the sandbox */
    window.Tesseract = {
      recognize: function () { return Promise.resolve({ data: { text: "INEC/ZT/245-239", confidence: 88 } }); }
    };
    idEl.value = "";
    return Promise.all([barcodeTests, platformTests, serverTests]).then(function () {
      return ocrScanFile({ name: "sticker.jpg" });
    }).then(function () {
      t("scan fills the device id", idEl.value === "245-239", JSON.stringify(idEl.value));
      t("scan reports the reading", msg().indexOf("245-239") !== -1, msg());
      t("scan re-enables the button", document.getElementById("scanBtn").disabled === false);

      /* nothing readable -> the officer types it instead */
      window.Tesseract.recognize = function () { return Promise.resolve({ data: { text: "NO DIGITS HERE", confidence: 20 } }); };
      idEl.value = "";
      return ocrScanFile({ name: "blur.jpg" });
    }).then(function () {
      t("unreadable scan leaves the box empty", idEl.value === "");
      t("unreadable scan explains what to do", msg().indexOf("No Device ID found") !== -1, msg());

      /* a clean, unambiguous read is not flagged even when Tesseract's own
         confidence is low, because a sticker photo is mostly background */
      window.Tesseract.recognize = function () { return Promise.resolve({ data: { text: "245-239", confidence: 25 } }); };
      idEl.value = "";
      return ocrScanFile({ name: "faint.jpg" });
    }).then(function () {
      t("clean scan still fills the box", idEl.value === "245-239", JSON.stringify(idEl.value));
      t("clean scan is not flagged as unsure", msg().indexOf("other readings") === -1 && msg().indexOf("Low-confidence") === -1, msg());

      /* two different readings -> filled, but the rival is shown for checking */
      window.Tesseract.recognize = function () { return Promise.resolve({ data: { text: "245-239 or 245-231", confidence: 70 } }); };
      idEl.value = "";
      return ocrScanFile({ name: "two.jpg" });
    }).then(function () {
      t("ambiguous scan fills the box", idEl.value === "245-239", JSON.stringify(idEl.value));
      t("ambiguous scan lists the other reading", msg().indexOf("other readings: 245-231") !== -1, msg());

      /* engine unavailable (no internet on the LAN) -> no crash, manual entry still works */
      window.Tesseract = undefined;
      ocrEnginePromise = null;
      idEl.value = "";
      return ocrScanFile({ name: "x.jpg" });
    }).then(function () {
      t("missing engine is handled", msg().indexOf("could not start") !== -1, msg());
      t("missing engine leaves the box empty", idEl.value === "");
      idEl.value = "245239";
      t("scanned ids go through the same validation", requireValidDeviceId(idEl.value).id === "245-239");
    });
  })();
`;

Promise.resolve(vm.runInContext(ocrDriver, context, { filename: "ocr-driver.js" })).then(() => {
  const failed = context.context_test_failed;
  console.log(failed ? "RESULT: FAILURES" : "RESULT: ALL PASS");
  process.exit(failed ? 1 : 0);
});
