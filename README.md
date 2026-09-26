# BVAS Device Health & Inventory Worksheet

Single-file web app for capturing per-state BVAS device battery tests and inventory.
Built for the ICT Department; structured for nationwide (all 36 states + FCT) use.

- Live site (GitHub Pages): `https://ojppresido.github.io/battery-calculator/`
- LAN host: served as static files (e.g. `python3 -m http.server 8000 --bind 0.0.0.0`)

## How URLs work

State is read from the URL **path only** (`?state=...` params are deliberately ignored):

| URL | Behaviour |
|---|---|
| `/battery-calculator/` | Shared root — **calculator only** |
| `/battery-calculator/states/ogun/` | Ogun full worksheet + Supabase sync |
| `/battery-calculator/states/kano/` | Kano full worksheet + Supabase sync |
| `/battery-calculator/states/fct-abuja/` | FCT ABUJA full worksheet + Supabase sync |

Each state resolves through `STATE_LOOKUP` in `index.html` (`fct-abuja` → `FCT ABUJA`).
The 37 real states are `OGUN, ONDO, ABIA, …, ZAMFARA, FCT ABUJA` (no placeholders).
The `/states/` folder is optional nesting for a tidy repo — the app detects the state from the
last path segment, so `…/states/ogun/` and `…/ogun/` both work.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html` | The app (calculator + worksheet + Supabase REST client). **Authoritative source.** |
| `styles.css` | Styling; linked cache-busted (`styles.css?v=6`). |
| `build_states.js` | Regenerates one page under `states/<state>/` (copy of `index.html` + `styles.css`) per state so path URLs resolve on static hosts. Also prunes state dirs no longer in `STATES`. |
| `states/<state>/` (e.g. `states/ogun/`, `states/ondo/`) | Generated per-state landing pages. Do not hand-edit. |
| `models/` | The committed OCR language model, `eng.traineddata.gz` (2.9 MB), served from the site's own origin so the first scan is not waiting on a third party. |
| `supabase/functions/bvas-read-device-id/` | Edge Function that reads a cropped sticker with a vision model. `index.js` talks to the model; `extract.mjs` holds the NNN-NNN rules and is unit-tested. Pasting these into the dashboard is the whole deploy. |
| `tests/` | Offline logic harnesses (no network needed): `harness.js` (full worksheet + Device ID OCR extraction + crop box + server answer handling), `db_harness.js` (ogun + mock Supabase), `path_harness.js` (URL-shape matrix incl. root/calc-only and ignored `?state=`), `server_ocr.test.js` (the reading rules). |
| `scripts/export_data.js` | Pulls every `bvas_devices_*` table into one JSON backup (read-only; uses the public anon key). |
| `supabase/migrations/` | `0001` (all per-state tables + initial RLS), `0002` (added real `ONDO`, dropped placeholders), `0003` (private-session RLS, `row_id`, and editable-row support). |

## Worksheet editing

Device IDs must be exactly three digits, a hyphen, then three digits (e.g. `101-701`). Six plain digits
are auto-formatted while typing; anything else (`345`, `101-70`, `101-7010`) is rejected on save.
SIM Type is required and starts on the `Select SIM type` placeholder; use `NO SIM` when a device has no
SIM. Saving a device clears the Device ID, SIM Type, remarks, component ticks, and the battery endurance
inputs (consumed mAh and minutes) so the next entry starts clean.

### Scanning the Device ID (OCR)

The camera button next to the Device ID box fills it from a photo instead of typing, to cut down
transcription mistakes. The sticker reads `INEC/ZT/245-239` but only the `245-239` part is picked up, so
the scan does not look for the whole label — it looks for the `NNN-NNN` run inside whatever the OCR
returns and fills that in.

- The box is **filled, not saved**: the officer still checks the digits against the sticker and presses
  `Save Device to Sheet`. The scanned value goes through exactly the same `101-701` validation as a
  typed one, so a scan can never put an invalid ID on the sheet.
- If the photo is unclear the box is left empty with a short message rather than a guess. When several
  readings are possible, the extra candidates are listed next to the box so the right digits can be
  chosen by eye.
- A photo is not read in one go. It is cleaned up and re-read up to seven times — cut three different
  ways and turned upright, 90°, 180° and 270° — because a single pass fails on its own for a sideways
  phone, a dark shell, glare or small print. The reading that several passes agree on wins, and the
  cascade stops as soon as one clean reading comes back, so a good photo costs a second or two. Tap the
  button again while it runs to cancel.
- A barcode on the sticker is read first, where the phone supports it: that answer is exact, needs no
  download and works with no internet at all.
- Photos are resized to at most 3400 px on the long side before reading, so a 50-megapixel camera does
  not stall the engine.
- Where the phone's own `TextDetector` exists, it is tried first — no download, no engine. It is behind
  a browser flag on Android, so most phones will not have it and fall through to the engine.
- Choosing a photo now opens a crop step: drag the box over the six digits (tap the photo to place the
  box, drag the dot to resize it, or take the whole frame) and then choose who reads it.
- **Two ways to read it.** "Read on this phone" runs the engine above and **never sends the photo
  anywhere**. "Read the ID" sends only the cropped sticker to the office server (see below). If the
  server cannot read it — no signal, function asleep, nothing legible — the app says so and reads the
  photo on the phone instead, so the two paths are a choice and a fallback, not a dependency.
- **The server path changes the privacy position, so it is opt-in per scan and stated in the dialog.**
  The crop is held in the server's memory for the length of one request and is never written to disk or
  into any table; only the six digits come back. Set `SERVER_OCR.on = false` in `index.html` to remove
  the server option entirely and keep every photo on the device.
- The language model ships with the app: `models/eng.traineddata.gz` (2.9 MB), fetched from this site's
  own origin. Tesseract's own default model is 10.9 MB served by `tessdata.projectnaptha.com`, measured
  here at 70 KB/s — over two and a half minutes, and it timed out before finishing; the committed model
  downloads in a couple of seconds and reads the digits just as well. `index.html` resolves the path
  with `new URL("models", new URL("../../", location.href))`, since state pages are verbatim copies two
  folders below the site root.
- The `tesseract.js` engine itself (script + WebAssembly core, ~8 MB) is still fetched from jsDelivr on
  the **first scan only** and then cached by the browser, so the first scan needs internet even on a LAN
  install. To go fully offline, drop `tesseract.min.js` into `vendor/` and point `OCR_SCRIPT_URL` in
  `index.html` at it.
- Reads `245-239`, `245239`, `245 239`, a misread hyphen such as `245~239`, and common glyph confusions
  (`O`→`0`, `S`→`5`, `A`→`4`, `Z`→`2`, …). Digit-shaped letters and dates (`2024-05-12`) are not
  reported as Device IDs.
- `tests/fixtures/` holds the simulated phone photos the pipeline is measured against — small print,
  sideways, upside down, dark, low-contrast, tilted, tiny, 8000×6000, and one with no Device ID in it.

Each saved inventory row has an `Edit` action. Edit the Device ID, battery result and hours, component
checkboxes, SIM type, or remarks, then use `Save`; `Cancel` leaves the row unchanged. The same Device ID
format and required SIM Type apply to inline edits. Battery re-test and
remove actions remain available. `Clear All` clears only the current browser session's local worksheet and
does not delete Supabase rows.

## Reading the sticker on the server

The on-device engine reads most stickers. A photo with glare, a shadow across the label or a faded
print is past it, and nothing more can be done about that on the phone alone. For those, the cropped
sticker can be read by a vision model running in a Supabase Edge Function.

Nothing is stored: the crop is read into memory, sent to the model, and dropped. Only the Device ID
comes back, and only if it is in the exact `NNN-NNN` form.

### Deploy it

1. Copy `supabase/functions/bvas-read-device-id/index.js` and `extract.mjs` from this repo.
2. Supabase Dashboard -> **Edge Functions** -> **New function** -> name it `bvas-read-device-id` ->
   paste `index.js` -> **Deploy**. Then use **Add new file** to add `extract.mjs` with exactly that
   name, in the same folder. Both files are needed: `index.js` does the talking to the model and
   `extract.mjs` holds the rules for what counts as a Device ID.
3. In the function's **Secrets** tab add `ANTHROPIC_API_KEY` with your key. That is the only secret.
4. Optional: add `BVAS_VISION_MODEL` = `claude-haiku-4-5` for a faster, cheaper read. The default is
   `claude-sonnet-5`, which is the more careful reader.
5. Optional: raise the function's limits in the dashboard (CPU time, memory) if reads are being cut off.

The app needs no change to call it: it posts to `/functions/v1/bvas-read-device-id` on the project URL
already in `index.html`, with the anon key it already holds. Until the function is deployed, the "Read
the ID" button reports a server error and the app falls back to reading on the phone.

### What it will not do

Return a number that is not `NNN-NNN`. Dates (`2024-05-12`), phone numbers, and longer serials are all
rejected rather than sliced into a plausible-looking id, and the rules in `extract.mjs` are covered by
`node tests/server_ocr.test.js`.

### Worth knowing before handover

The anon key is public in the page, so anyone who opens the app can call this function. Size limits and
a JPEG-only check are in place, but they are not a security boundary — for real protection, put the
function behind something that can tell a real officer from a script. A vision call costs a fraction
of a cent; a script looping over it would not be free.

## Development workflow

Every change starts in `index.html`:

1. Edit `index.html`.
2. `node build_states.js` — regenerates all per-state pages (and prunes removed states).
3. `node tests/harness.js && node tests/db_harness.js && node tests/path_harness.js` — all must pass.
4. Apply any new `supabase/migrations/*.sql` in the Supabase SQL Editor.
5. Commit + push to `main` — GitHub Pages auto-deploys.

Adding/removing a state: change the `STATES` array in `index.html`, regenerate, and (for the DB) add a
Supabase migration mirroring `0002` (drop old table / create new one). Never edit `states/<state>/` files by hand.

## Database (Supabase)

- REST via native `fetch` against `POSTGREST` — no SDK, no CDN. (The Device ID scanner is the one
  exception: it lazily pulls `tesseract.js` from a CDN on first use. The database client has no
  external dependency.)
- One table per state: `bvas_devices_<state>` (`bvas_devices_ogun`, `bvas_devices_fct_abuja`, …).
- Since migration `0003`, every table has a stable `row_id`, an `owner_key_hash`, and RLS policies that hash
  the private `X-BVAS-Session` request header before comparing ownership. Device IDs are unique per session,
  not globally, and the client upserts with `on_conflict=row_id`.
- The app stores a random session ID in `sessionStorage`; each browser tab has a separate private namespace.
  `New Session` rotates that ID. The session ID is a capability and must not be shared.
- Rows created before `0003` are assigned a legacy sentinel owner during migration and are intentionally not
  visible to new sessions. Export any existing data before applying the migration if it must be retained.
- Database address lives in the app because a static page has no server to inject env vars; the **anon key
  is public by design and exists only to identify requests** — RLS is the actual gate.

### Secrets policy (important for handover)

- `SUPABASE_URL` + `SUPABASE_ANON_KEY` are in `index.html` — safe to share/publish.
- The **`service_role` key** must **never** appear in the repo or the app; it bypasses RLS.
  It lives only in the Supabase Dashboard.
- Rotate the anon key + any shared personal tokens after transferring ownership.

### Data export / handover

- `BVAS_SESSION_ID=<session UUID> node scripts/export_data.js` dumps the rows visible to that private session
  to `bvas-db-export-<date>.json` (read-only). Override the endpoint/key with `SUPABASE_URL=...` and
  `SUPABASE_ANON_KEY=...`. A session ID is required after migration `0003`; it is not an admin credential.

## Ownership handover checklist

1. **Code:** transfer this repo to the HQ org account, or push a copy into an org-owned repo.
2. **Database:** transfer the Supabase project to HQ's org admin, **or** run `0001` + `0002` + `0003` into a
   fresh Supabase project they own and import the exported backup before enabling session-scoped access.
3. **Secrets:** hand over the schema + anon key openly; keep `service_role` server-side only.
4. **Docs:** this README + the tests/build script are part of the repo, so the workflow transfers intact.
5. **Rotate** personal GitHub tokens and the old anon key after handover.