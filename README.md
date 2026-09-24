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
| `styles.css` | Styling; linked cache-busted (`styles.css?v=4`). |
| `build_states.js` | Regenerates one page under `states/<state>/` (copy of `index.html` + `styles.css`) per state so path URLs resolve on static hosts. Also prunes state dirs no longer in `STATES`. |
| `states/<state>/` (e.g. `states/ogun/`, `states/ondo/`) | Generated per-state landing pages. Do not hand-edit. |
| `tests/` | Offline logic harnesses (no network needed): `harness.js` (full worksheet), `db_harness.js` (ogun + mock Supabase), `path_harness.js` (URL-shape matrix incl. root/calc-only and ignored `?state=`). |
| `scripts/export_data.js` | Pulls every `bvas_devices_*` table into one JSON backup (read-only; uses the public anon key). |
| `supabase/migrations/` | `0001` (all per-state tables + RLS), `0002` (added real `ONDO`, dropped placeholder `ALABA`/`OGOMO`). |

## Development workflow

Every change starts in `index.html`:

1. Edit `index.html`.
2. `node build_states.js` — regenerates all per-state pages (and prunes removed states).
3. `node tests/harness.js && node tests/db_harness.js && node tests/path_harness.js` — all must pass.
4. Commit + push to `main` — GitHub Pages auto-deploys.

Adding/removing a state: change the `STATES` array in `index.html`, regenerate, and (for the DB) add a
Supabase migration mirroring `0002` (drop old table / create new one). Never edit `states/<state>/` files by hand.

## Database (Supabase)

- REST via native `fetch` against `POSTGREST` — no SDK, no CDN.
- One table per state: `bvas_devices_<state>` (`bvas_devices_ogun`, `bvas_devices_fct_abuja`, …).
- Every table: RLS enabled with four `anon` policies (select/insert/update/delete) + grants, keyed by
  `upsert ... on_conflict=device_id` (unique `device_id` per table).
- Database address lives in the app because a static page has no server to inject env vars; the **anon key
  is public by design and exists only to identify requests** — RLS is the actual gate.

### Secrets policy (important for handover)

- `SUPABASE_URL` + `SUPABASE_ANON_KEY` are in `index.html` — safe to share/publish.
- The **`service_role` key** must **never** appear in the repo or the app; it bypasses RLS.
  It lives only in the Supabase Dashboard.
- Rotate the anon key + any shared personal tokens after transferring ownership.

### Data export / handover

- `node scripts/export_data.js` dumps all `bvas_devices_*` rows to `bvas-db-export-<date>.json`
  (runs read-only with the anon key). Override the endpoint with
  `SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export_data.js`.

## Ownership handover checklist

1. **Code:** transfer this repo to the HQ org account, or push a copy into an org-owned repo.
2. **Database:** transfer the Supabase project to HQ's org admin, **or** run `0001` + `0002` into a fresh
   Supabase project they own and import the exported backup.
3. **Secrets:** hand over the schema + anon key openly; keep `service_role` server-side only.
4. **Docs:** this README + the tests/build script are part of the repo, so the workflow transfers intact.
5. **Rotate** personal GitHub tokens and the old anon key after handover.