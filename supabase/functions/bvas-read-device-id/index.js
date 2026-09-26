/* =========================================================
   BVAS — read a Device ID from a photo of a sticker
   ---------------------------------------------------------
   HOW TO DEPLOY
   Supabase Dashboard -> Edge Functions -> New function -> name it
   bvas-read-device-id -> paste this whole file -> Deploy. Then
   Dashboard -> Edge Functions -> bvas-read-device-id -> Secrets ->
   New secret: ANTHROPIC_API_KEY = your key. (Optional:
   BVAS_VISION_MODEL = claude-haiku-4-5 for a faster, cheaper read.)

   WHAT IT DOES
   Takes one cropped JPEG of the sticker, asks a vision model to read
   the Device ID, and returns the six digits. The photo is not written
   anywhere: it is held in memory for the length of the request and
   dropped. Only the reading comes back.

   WHAT IT WILL NOT DO
   Return a number that is not NNN-NNN. Dates, phone numbers and
   longer serials are rejected, and if nothing is readable the answer
   is device_id: null rather than a guess.
   ========================================================= */

import { pickDeviceId } from "./extract.mjs";

/* Sonnet reads the awkward field photos best. Haiku is the cheap,
   fast alternative if you would rather spend less per scan. */
const MODEL = Deno.env.get("BVAS_VISION_MODEL") || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const API_URL = "https://api.anthropic.com/v1/messages";

/* A crop from the app is around 100-200 KB. This ceiling is well
   above that and stops the function being used as free storage. */
const MAX_IMAGE_BYTES = 3_500_000;
const TIMEOUT_MS = 30_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bvas-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

const SYSTEM = [
  "You read Device IDs off equipment stickers for a field inventory app.",
  "A Device ID is exactly three digits, a hyphen, then three digits: NNN-NNN.",
  "The sticker may also carry a model name, a serial number, a date and a phone",
  "number. Those are NOT Device IDs. Ignore them, however large or clear they are.",
  "Look for the six digits in the NNN-NNN form, usually the largest number on the",
  "label. Read the digits as printed; do not correct a digit you are unsure of.",
  "If you cannot see a NNN-NNN with confidence, say so instead of guessing."
].join(" ");

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

function fail(message, status) {
  return json({ error: message }, status || 400);
}

/* Accepts a data URL or bare base64. Refuses anything that is not
   actually a JPEG, so the function cannot be used as a file drop. */
function decodeImage(input) {
  let b64 = String(input || "").trim();
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:")) {
    if (comma < 0) return { error: "malformed data url" };
    b64 = b64.slice(comma + 1);
  }
  b64 = b64.replace(/\s+/g, "");
  if (!b64) return { error: "no image" };
  if (b64.length * 0.75 > MAX_IMAGE_BYTES) return { error: "image too large" };
  let bytes;
  try {
    const raw = atob(b64);
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  } catch (e) {
    return { error: "image is not valid base64" };
  }
  /* JPEG magic: FF D8 FF */
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { error: "only JPEG crops are accepted" };
  }
  return { bytes, b64 };
}

async function askModel(b64) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { error: "ANTHROPIC_API_KEY is not set on the function", status: 500 };

  const body = {
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          {
            type: "text",
            text:
              "Read the Device ID from this sticker. Reply with JSON only, no other text:\n" +
              '{"device_id": "NNN-NNN" or null, "raw_text": "the text you can actually see", ' +
              '"confidence": "high" | "medium" | "low", "note": "one short sentence"}\n' +
              "Set device_id to null unless you can see all six digits and a hyphen."
          }
        ]
      }
    ]
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let reply;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try { detail = JSON.parse(text).error.message || detail; } catch (e) { /* keep the text */ }
      return { error: "model call failed (" + res.status + "): " + detail, status: 502 };
    }
    reply = JSON.parse(text);
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message || e)));
    return { error: aborted ? "model call timed out" : "could not reach the model", status: 504 };
  } finally {
    clearTimeout(timer);
  }

  const parts = ((reply && reply.content) || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text: parts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail("POST only", 405);

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return fail("body must be JSON");
  }
  if (!payload || typeof payload !== "object") return fail("body must be JSON");

  const shot = decodeImage(payload.image);
  if (shot.error) return fail(shot.error, shot.status || 400);

  const asked = await askModel(shot.b64);
  if (asked.error) return fail(asked.error, asked.status);

  const picked = pickDeviceId(asked.text);
  let confidence = "low";
  try {
    const stated = JSON.parse(String(asked.text).trim());
    if (stated && stated.confidence) confidence = String(stated.confidence);
  } catch (e) { /* the parser already coped with a non-JSON reply */ }

  return json({
    device_id: picked.id,
    raw_text: String(picked.raw || "").slice(0, 500),
    confidence,
    model: MODEL
  });
});
