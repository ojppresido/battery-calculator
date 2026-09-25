begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

set local search_path = public, extensions;

create or replace function public.bvas_session_hash()
returns text
language sql
stable
security definer
set search_path = pg_catalog, extensions
as $function$
  with headers as (
    select nullif(current_setting('request.headers', true), '')::jsonb as value
  )
  select case
    when coalesce(value->>'x-bvas-session', value->>'X-BVAS-Session') is not null
      then encode(digest(coalesce(value->>'x-bvas-session', value->>'X-BVAS-Session'), 'sha256'), 'hex')
    else null
  end
  from headers;
$function$;

revoke execute on function public.bvas_session_hash() from public;
grant execute on function public.bvas_session_hash() to anon;

create or replace function public.bvas_set_session_owner()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $function$
begin
  if tg_op = 'INSERT' then
    new.owner_key_hash := public.bvas_session_hash();
  elsif tg_op = 'UPDATE' then
    new.owner_key_hash := old.owner_key_hash;
  end if;
  return new;
end;
$function$;

do $$
declare
  state_name text;
  tbl text;
  legacy_hash text;
  states text[] := array[
    'OGUN', 'ONDO', 'ABIA', 'ADAMAWA', 'AKWA IBOM', 'ANAMBRA', 'BAUCHI',
    'BAYELSA', 'BENUE', 'BORNO', 'CROSS RIVER', 'DELTA', 'EBONYI', 'EDO',
    'EKITI', 'ENUGU', 'GOMBE', 'IMO', 'JIGAWA', 'KADUNA', 'KANO', 'KATSINA',
    'KEBBI', 'KOGI', 'KWARA', 'LAGOS', 'NASSARAWA', 'NIGER', 'OSUN', 'OYO',
    'PLATEAU', 'RIVERS', 'SOKOTO', 'TARABA', 'YOBE', 'ZAMFARA', 'FCT ABUJA'
  ];
begin
  foreach state_name in array states loop
    tbl := 'bvas_devices_' || lower(replace(state_name, ' ', '_'));
    legacy_hash := encode(digest('bvas-legacy:' || tbl, 'sha256'), 'hex');

    execute format('alter table %I add column if not exists row_id uuid', tbl);
    execute format('alter table %I add column if not exists owner_key_hash text', tbl);
    execute format('update %I set row_id = gen_random_uuid() where row_id is null', tbl);
    execute format('alter table %I alter column row_id set default gen_random_uuid()', tbl);
    execute format('alter table %I alter column row_id set not null', tbl);
    execute format('update %I set owner_key_hash = %L where owner_key_hash is null or owner_key_hash = %L', tbl, legacy_hash, '');
    execute format('alter table %I alter column owner_key_hash set not null', tbl);

    execute format('alter table %I drop constraint if exists %I', tbl, tbl || '_device_id_key');
    execute format('alter table %I drop constraint if exists %I', tbl, tbl || '_owner_device_key');
    execute format('alter table %I drop constraint if exists %I', tbl, tbl || '_row_id_key');
    execute format('alter table %I add constraint %I unique (owner_key_hash, device_id)', tbl, tbl || '_owner_device_key');
    execute format('alter table %I add constraint %I unique (row_id)', tbl, tbl || '_row_id_key');
    execute format('create index if not exists %I on %I (owner_key_hash)', tbl || '_owner_idx', tbl);

    execute format('drop trigger if exists bvas_set_session_owner on %I', tbl);
    execute format('create trigger bvas_set_session_owner before insert or update on %I for each row execute function public.bvas_set_session_owner()', tbl);

    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "bvas_anon_select" on %I', tbl);
    execute format('drop policy if exists "bvas_anon_insert" on %I', tbl);
    execute format('drop policy if exists "bvas_anon_update" on %I', tbl);
    execute format('drop policy if exists "bvas_anon_delete" on %I', tbl);
    execute format('create policy "bvas_anon_select" on %I for select to anon using (owner_key_hash = public.bvas_session_hash())', tbl);
    execute format('create policy "bvas_anon_insert" on %I for insert to anon with check (owner_key_hash = public.bvas_session_hash())', tbl);
    execute format('create policy "bvas_anon_update" on %I for update to anon using (owner_key_hash = public.bvas_session_hash()) with check (owner_key_hash = public.bvas_session_hash())', tbl);
    execute format('create policy "bvas_anon_delete" on %I for delete to anon using (owner_key_hash = public.bvas_session_hash())', tbl);
    execute format('grant select, insert, update, delete on table %I to anon', tbl);
  end loop;
end $$;

grant usage, select on all sequences in schema public to anon;

commit;
