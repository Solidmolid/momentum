-- Momentum Cloud schema
-- Safe to run repeatedly in the Supabase SQL editor.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null,
  status text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

alter table public.user_states
  add column if not exists version bigint not null default 1;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.sketches (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- These constraints are NOT VALID so an existing deployment can be hardened
-- without being blocked by a historical malformed row. PostgreSQL still
-- enforces them for every new or updated row. The RPCs below independently
-- validate every document before writing it.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sketches'::regclass
      and conname = 'sketches_document_size_limit'
  ) then
    alter table public.sketches
      add constraint sketches_document_size_limit
      check (pg_catalog.octet_length(document::text) <= 8388608)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sketches'::regclass
      and conname = 'sketches_document_structure'
  ) then
    alter table public.sketches
      add constraint sketches_document_structure
      check (
        deleted_at is not null
        or (
          pg_catalog.jsonb_typeof(document) is not distinct from 'object'
          and (document ->> 'id') is not distinct from id
          and pg_catalog.jsonb_typeof(document -> 'schemaVersion') is not distinct from 'number'
          and pg_catalog.jsonb_typeof(document -> 'title') is not distinct from 'string'
          and pg_catalog.char_length(document ->> 'title') between 1 and 80
          and pg_catalog.jsonb_typeof(document -> 'description') is not distinct from 'string'
          and pg_catalog.char_length(document ->> 'description') <= 500
          and pg_catalog.jsonb_typeof(document -> 'documentDate') is not distinct from 'string'
          and coalesce((document ->> 'documentDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
          and pg_catalog.jsonb_typeof(document -> 'createdAt') is not distinct from 'number'
          and pg_catalog.jsonb_typeof(document -> 'updatedAt') is not distinct from 'number'
          and pg_catalog.jsonb_typeof(document -> 'canvas') is not distinct from 'object'
          and pg_catalog.jsonb_typeof(document -> 'elements') is not distinct from 'array'
          and case
            when pg_catalog.jsonb_typeof(document -> 'elements') = 'array'
              then pg_catalog.jsonb_array_length(document -> 'elements') <= 5000
            else false
          end
        )
      )
      not valid;
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_states enable row level security;
alter table public.admin_users enable row level security;
alter table public.sketches enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users as admins
    join public.profiles as profiles on profiles.id = admins.user_id
    where admins.user_id = (select auth.uid())
      and profiles.status = 'active'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.touch_user_state_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_states_set_updated_at on public.user_states;
create trigger user_states_set_updated_at
  before update on public.user_states
  for each row execute procedure public.touch_user_state_updated_at();

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id and (select public.is_active_user()))
  with check ((select auth.uid()) = id and (select public.is_active_user()));

drop policy if exists "user_states_select_own" on public.user_states;
create policy "user_states_select_own"
  on public.user_states for select
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()));

drop policy if exists "user_states_insert_own" on public.user_states;
drop policy if exists "user_states_update_own" on public.user_states;
drop policy if exists "user_states_delete_own" on public.user_states;

drop policy if exists "sketches_select_own" on public.sketches;
create policy "sketches_select_own"
  on public.sketches for select
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()));

drop policy if exists "sketches_insert_own" on public.sketches;
drop policy if exists "sketches_update_own" on public.sketches;

create or replace function public.save_user_state(
  p_state jsonb,
  p_expected_version bigint default 0
)
returns public.user_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  existing public.user_states;
  saved public.user_states;
begin
  current_user_id := (select auth.uid());
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = current_user_id and status = 'active'
  ) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0
    or pg_catalog.jsonb_typeof(p_state) is distinct from 'object'
    or pg_catalog.octet_length(p_state::text) > 8388608
  then
    raise exception 'invalid_user_state' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 1297040470)
  );

  select * into existing
  from public.user_states
  where user_id = current_user_id
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception 'state_conflict' using errcode = '40001';
    end if;
    insert into public.user_states (user_id, state)
    values (current_user_id, p_state)
    returning * into saved;
    return saved;
  end if;

  -- Wiederholte Anfrage nach verlorener Antwort: bereits gespeicherte Version
  -- zurückgeben, statt einen künstlichen Konflikt zu erzeugen.
  if existing.state = p_state
    and (existing.version = p_expected_version or existing.version - 1 = p_expected_version)
  then
    return existing;
  end if;

  if existing.version <> p_expected_version then
    raise exception 'state_conflict' using errcode = '40001';
  end if;

  update public.user_states
  set state = p_state,
      version = version + 1
  where user_id = current_user_id
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.save_sketch_document(
  p_id text,
  p_document jsonb,
  p_expected_version bigint default 0
)
returns public.sketches
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Client and server intentionally share the 8 MiB per-document limit.
  max_document_bytes constant bigint := 8388608;
  max_active_sketches constant bigint := 250;
  max_total_rows constant bigint := 1000;
  max_active_bytes constant bigint := 67108864;
  current_user_id uuid;
  document_bytes bigint;
  total_rows bigint;
  active_rows bigint;
  active_bytes bigint;
  existing public.sketches;
  existing_found boolean;
  saved public.sketches;
begin
  current_user_id := (select auth.uid());
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = current_user_id
      and status = 'active'
  ) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;

  if p_expected_version is null
    or p_expected_version < 0
    or p_expected_version >= 9223372036854775807
  then
    raise exception 'invalid_sketch_document' using errcode = '22023';
  end if;

  if not coalesce(p_id ~ '^[A-Za-z0-9_-]{1,128}$', false)
    or pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
    or (p_document ->> 'id') is distinct from p_id
    or pg_catalog.jsonb_typeof(p_document -> 'schemaVersion') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_document -> 'title') is distinct from 'string'
    or pg_catalog.char_length(p_document ->> 'title') not between 1 and 80
    or pg_catalog.jsonb_typeof(p_document -> 'description') is distinct from 'string'
    or pg_catalog.char_length(p_document ->> 'description') > 500
    or pg_catalog.jsonb_typeof(p_document -> 'documentDate') is distinct from 'string'
    or not coalesce((p_document ->> 'documentDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
    or pg_catalog.jsonb_typeof(p_document -> 'createdAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_document -> 'updatedAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_document -> 'canvas') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_document -> 'elements') is distinct from 'array'
  then
    raise exception 'invalid_sketch_document' using errcode = '22023';
  end if;

  document_bytes := pg_catalog.octet_length(p_document::text);
  if document_bytes > max_document_bytes then
    raise exception 'sketch_document_too_large' using errcode = '54000';
  end if;

  if pg_catalog.jsonb_array_length(p_document -> 'elements') > 5000 then
    raise exception 'invalid_sketch_document' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_document -> 'elements') as item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
      or not coalesce((item.value ->> 'id') ~ '^[A-Za-z0-9_-]{1,128}$', false)
      or coalesce(item.value ->> 'type', '') not in ('stroke', 'text')
  ) then
    raise exception 'invalid_sketch_document' using errcode = '22023';
  end if;

  -- All sketch mutations for one account share a transaction-scoped lock.
  -- This makes the count/byte quotas reliable even for parallel devices.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 1297040469)
  );

  select *
  into existing
  from public.sketches
  where user_id = current_user_id
    and id = p_id
  for update;
  existing_found := found;

  -- A retry after a lost network response is idempotent instead of creating
  -- an unnecessary conflict copy on the client.
  if existing_found
    and existing.deleted_at is null
    and existing.document = p_document
    and (
      p_expected_version = 0
      or existing.version = p_expected_version
      or existing.version - 1 = p_expected_version
    )
  then
    return existing;
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where deleted_at is null),
    coalesce(
      pg_catalog.sum(pg_catalog.octet_length(document::text)) filter (where deleted_at is null),
      0
    )
  into total_rows, active_rows, active_bytes
  from public.sketches
  where user_id = current_user_id;

  if p_expected_version = 0 then
    if existing_found then
      raise exception 'sketch_conflict' using errcode = '40001';
    end if;
    if total_rows >= max_total_rows or active_rows >= max_active_sketches then
      raise exception 'sketch_quota_exceeded' using errcode = '54000';
    end if;
    if active_bytes + document_bytes > max_active_bytes then
      raise exception 'sketch_storage_quota_exceeded' using errcode = '54000';
    end if;

    insert into public.sketches (user_id, id, document)
    values (current_user_id, p_id, p_document)
    on conflict (user_id, id) do nothing
    returning * into saved;
  else
    if not existing_found
      or existing.deleted_at is not null
      or existing.version <> p_expected_version
    then
      raise exception 'sketch_conflict' using errcode = '40001';
    end if;
    if active_bytes
      - pg_catalog.octet_length(existing.document::text)
      + document_bytes > max_active_bytes
    then
      raise exception 'sketch_storage_quota_exceeded' using errcode = '54000';
    end if;

    update public.sketches
    set document = p_document,
        version = version + 1,
        updated_at = now(),
        deleted_at = null
    where user_id = current_user_id
      and id = p_id
      and version = p_expected_version
      and deleted_at is null
    returning * into saved;
  end if;

  if saved.id is null then
    raise exception 'sketch_conflict' using errcode = '40001';
  end if;
  return saved;
end;
$$;

create or replace function public.delete_sketch_document(
  p_id text,
  p_expected_version bigint
)
returns public.sketches
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  existing public.sketches;
  saved public.sketches;
begin
  current_user_id := (select auth.uid());
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = current_user_id
      and status = 'active'
  ) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;
  if not coalesce(p_id ~ '^[A-Za-z0-9_-]{1,128}$', false)
    or p_expected_version is null
    or p_expected_version < 1
    or p_expected_version >= 9223372036854775807
  then
    raise exception 'invalid_sketch_delete' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 1297040469)
  );

  select *
  into existing
  from public.sketches
  where user_id = current_user_id
    and id = p_id
  for update;

  -- The first retry after a lost delete response is safe and idempotent.
  if found
    and existing.deleted_at is not null
    and existing.version - 1 = p_expected_version
  then
    return existing;
  end if;

  update public.sketches
  set document = pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'id', p_id,
        'deleted', true
      ),
      version = version + 1,
      updated_at = now(),
      deleted_at = now()
  where user_id = current_user_id
    and id = p_id
    and version = p_expected_version
    and deleted_at is null
  returning * into saved;

  if saved.id is null then
    raise exception 'sketch_conflict' using errcode = '40001';
  end if;
  return saved;
end;
$$;

revoke all on function public.save_user_state(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.save_sketch_document(text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.delete_sketch_document(text, bigint) from public, anon, authenticated;
grant execute on function public.save_user_state(jsonb, bigint) to authenticated;
grant execute on function public.save_sketch_document(text, jsonb, bigint) to authenticated;
grant execute on function public.delete_sketch_document(text, bigint) to authenticated;

revoke all on public.profiles from anon, authenticated;
revoke all on public.user_states from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;
revoke all on public.sketches from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, last_seen_at) on public.profiles to authenticated;
grant select on public.user_states to authenticated;
grant select on public.sketches to authenticated;

-- Created by Supabase's automatic-RLS option. It only needs event-trigger access.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

commit;
