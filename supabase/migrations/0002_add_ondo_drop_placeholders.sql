-- =========================================================
-- BVAS — migration 0002: drop placeholder states, add ONDO
-- ---------------------------------------------------------
-- Removes the placeholder tables (ALABA, OGOMO) that were never
-- real Nigerian states, and creates the real bvas_devices_ondo table.
-- Safe to re-run (idempotent).
-- =========================================================

begin;

drop table if exists bvas_devices_alaba;
drop table if exists bvas_devices_ogomo;

do $$
declare
  tbl text := 'bvas_devices_ondo';
begin
  execute format('create table if not exists %I (
    id            bigint generated always as identity primary key,
    device_id     text not null,
    ts            bigint not null default 0,
    sim_type      text,
    state         text not null,
    screen        boolean not null default false,
    camera        boolean not null default false,
    fingerprint   boolean not null default false,
    sim           boolean not null default false,
    charging      boolean not null default false,
    wifi          boolean not null default false,
    gps           boolean not null default false,
    battery_ok    boolean,
    battery_hours numeric(8,2),
    status        text,
    remarks       text,
    created_at    timestamptz not null default now(),
    constraint %I unique (device_id)
  )', tbl, tbl || '_device_id_key');

  execute format('alter table %I enable row level security', tbl);

  execute format('drop policy if exists "bvas_anon_select" on %I', tbl);
  execute format('drop policy if exists "bvas_anon_insert" on %I', tbl);
  execute format('drop policy if exists "bvas_anon_update" on %I', tbl);
  execute format('drop policy if exists "bvas_anon_delete" on %I', tbl);

  execute format('create policy "bvas_anon_select" on %I for select to anon using (true)', tbl);
  execute format('create policy "bvas_anon_insert" on %I for insert to anon with check (true)', tbl);
  execute format('create policy "bvas_anon_update" on %I for update to anon using (true) with check (true)', tbl);
  execute format('create policy "bvas_anon_delete" on %I for delete to anon using (true)', tbl);

  execute format('grant select, insert, update, delete on table %I to anon', tbl);
end $$;

commit;