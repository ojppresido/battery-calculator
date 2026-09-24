-- =========================================================
-- BVAS Device Health & Inventory — per-state tables for Supabase
-- ---------------------------------------------------------
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query
--            -> paste the whole content of this file -> click Run.
--
-- Creates one table per state: bvas_devices_<state>
--   e.g. bvas_devices_ogun, bvas_devices_lagos, bvas_devices_fct_abuja
-- Each table has Row Level Security enabled with anon read/write
-- so the app (public anon key) can save/load that state's devices.
-- Safe to re-run (idempotent).
-- =========================================================

begin;

do $$
declare
  state_name text;
  tbl       text;
  states    text[] := array[
'OGUN',
        'ABIA',
        'ADAMAWA',
        'AKWA IBOM',
        'ALABA',
        'ANAMBRA',
        'BAUCHI',
        'BAYELSA',
        'BENUE',
        'BORNO',
        'CROSS RIVER',
        'DELTA',
        'EBONYI',
        'EDO',
        'EKITI',
        'ENUGU',
        'GOMBE',
        'IMO',
        'JIGAWA',
        'KADUNA',
        'KANO',
        'KATSINA',
        'KEBBI',
        'KOGI',
        'KWARA',
        'LAGOS',
        'NASSARAWA',
        'NIGER',
        'OGOMO',
        'OSUN',
        'OYO',
        'PLATEAU',
        'RIVERS',
        'SOKOTO',
        'TARABA',
        'YOBE',
        'ZAMFARA',
        'FCT ABUJA'
  ];
begin
  foreach state_name in array states loop
    tbl := 'bvas_devices_' || lower(replace(state_name, ' ', '_'));

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
  end loop;
end $$;

commit;
