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
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_states enable row level security;
alter table public.admin_users enable row level security;

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
create policy "user_states_insert_own"
  on public.user_states for insert
  to authenticated
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));

drop policy if exists "user_states_update_own" on public.user_states;
create policy "user_states_update_own"
  on public.user_states for update
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()))
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));

drop policy if exists "user_states_delete_own" on public.user_states;
create policy "user_states_delete_own"
  on public.user_states for delete
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()));

revoke all on public.profiles from anon, authenticated;
revoke all on public.user_states from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, last_seen_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.user_states to authenticated;

-- Created by Supabase's automatic-RLS option. It only needs event-trigger access.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

commit;
