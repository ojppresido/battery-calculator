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
| `tests/` | Offline logic harnesses (no network needed): `harness.js` (full worksheet + Device ID OCR extraction), `db_harness.js` (ogun + mock Supabase), `path_harness.js` (URL-shape matrix incl. root/calc-only and ignored `?state=`). |
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
  readings are possible, or the OCR was low-confidence, the extra candidates are listed next to the box
  so the right digits can be chosen by eye.
- Recognition runs entirely in the browser; **the photo is never uploaded** anywhere.
- `tesseract.js` is fetched from jsDelivr on the **first scan only** (~8 MB of engine + language data,
  then cached by the browser). The first scan therefore needs internet, even on a LAN install. To go
  fully offline, drop `tesseract.min.js` into `vendor/` and point `OCR_SCRIPT_URL` in `index.html` at it.
- Reads `245-239`, `245239`, `245 239`, a misread hyphen such as `245~239`, and common glyph confusions
  (`O`→`0`, `S`→`5`, `A`→`4`, `Z`→`2`, …). Digit-shaped letters and dates (`2024-05-12`) are not
  reported as Device IDs.

Each saved inventory row has an `Edit` action. Edit the Device ID, battery result and hours, component
checkboxes, SIM type, or remarks, then use `Save`; `Cancel` leaves the row unchanged. The same Device ID
format and required SIM Type apply to inline edits. Battery re-test and
remove actions remain available. `Clear All` clears only the current browser session's local worksheet and
does not delete Supabase rows.

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