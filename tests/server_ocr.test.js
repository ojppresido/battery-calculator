/* =========================================================
   Tests for the server-side reading rules
   ---------------------------------------------------------
   Run: node tests/server_ocr.test.js
   These are the rules the edge function applies to a model's
   answer, kept here so a change to them has to be deliberate:
   a Device ID is NNN-NNN and nothing else gets through.
   ========================================================= */

const path = require("path");

(async () => {
  const mod = await import(path.join(
    __dirname, "..", "supabase", "functions", "bvas-read-device-id", "extract.mjs"
  ));
  const { pickDeviceId, findDeviceIds, isDeviceId } = mod;

  let pass = 0;
  const fails = [];
  function t(name, cond, extra) {
    if (cond) { pass++; console.log("PASS: " + name); }
    else { fails.push(name); console.log("FAIL: " + name + (extra != null ? "  -> " + extra : "")); }
  }

  /* ---- the answer the model gives ---- */
  t("a plain reading is taken as given",
    pickDeviceId('{"device_id":"245-239"}').id === "245-239");
  t("a reading with a digit-shaped letter is corrected",
    pickDeviceId('{"device_id":"1O1-7O1"}').id === "101-701");
  t("a model that says none is believed",
    pickDeviceId('{"device_id":null,"raw_text":"nothing here"}').id === null);
  t("a worded refusal is not read as an id",
    pickDeviceId("I cannot find a Device ID on this sticker.").id === null);
  t("a reading surrounded by chatter is still found",
    pickDeviceId('Sure! {"device_id":"808-432","confidence":"high"} hope that helps').id === "808-432");
  t("raw_text is searched when the model left device_id empty",
    pickDeviceId('{"device_id":null,"raw_text":"INEC/ZT 245-239"}').id === "245-239");

  /* ---- numbers that must never be read as a Device ID ---- */
  const rejects = [
    ["a date", '{"device_id":null,"raw_text":"MFG 2024-05-12"}'],
    ["a date with slashes", '{"device_id":null,"raw_text":"2024/05/12"}'],
    ["a phone number", '{"device_id":null,"raw_text":"0803 555 0192"}'],
    ["a phone number, unbroken", '{"device_id":null,"raw_text":"08035550192"}'],
    ["a long serial", '{"device_id":null,"raw_text":"SN 88231-A7"}'],
    ["a nine-digit number", '{"device_id":null,"raw_text":"123456789"}'],
    ["a brand name beside nothing", '{"device_id":null,"raw_text":"INEC/ZT"}'],
    ["a model code", '{"device_id":null,"raw_text":"ZT-245-2"}'],
    ["a model code with a hyphen", '{"device_id":null,"raw_text":"ZT-245-2A"}'],
    ["bare letters", '{"device_id":null,"raw_text":"NO ID"}'],
    ["an empty answer", ""]
  ];
  for (const [name, reply] of rejects) {
    const got = pickDeviceId(reply).id;
    t("refuses " + name, got === null, got);
  }

  /* ---- the id survives the shapes a sticker is printed in ---- */
  const accepts = [
    ["plain", "245-239", "245-239"],
    ["no hyphen", "245239", "245-239"],
    ["spaced", "245 239", "245-239"],
    ["dot", "245.239", "245-239"],
    ["tilde", "245~239", "245-239"],
    ["slash", "245/239", "245-239"],
    ["O for zero", "2O5-2S9", "205-259"],
    ["a date in front of it", "2024-05-12 245-239", "245-239"],
    ["a phone number in front of it", "08035550192 101-701", "101-701"],
    ["the real sticker text", "INEC/ZT/245-239", "245-239"],
    ["brand name then id", "INEC ZT 245-239", "245-239"]
  ];
  for (const [name, raw, want] of accepts) {
    const got = findDeviceIds(raw).map((c) => c.id);
    t("accepts " + name, got.indexOf(want) >= 0, got.join(","));
  }

  /* ---- format gate ---- */
  t("NNN-NNN is a Device ID", isDeviceId("245-239"));
  t("244 digits is not", !isDeviceId("245-23"));
  t("letters are not", !isDeviceId("245-2X9"));
  t("a date is not", !isDeviceId("2024-05-12"));
  t("empty is not", !isDeviceId(""));
  t("surrounding space is tolerated", isDeviceId("  245-239  "));

  /* ---- every candidate is offered, best first, no duplicates ---- */
  const many = findDeviceIds("245-239 and 245-239 again, plus 101-701");
  t("duplicates are collapsed", many.filter((c) => c.id === "245-239").length === 1, JSON.stringify(many));
  t("candidates come back in reading order", many[0].id === "245-239" && many[1].id === "101-701", JSON.stringify(many));

  console.log("\n" + pass + " passed, " + fails.length + " failed");
  if (fails.length) { fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
})();
