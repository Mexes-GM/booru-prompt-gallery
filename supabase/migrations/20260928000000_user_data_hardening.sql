-- ============================================================================
-- User data hardening
-- ============================================================================
-- Idempotente: se puede correr sobre la DB de producción ya poblada.
--
-- Qué hace:
--   1. Versiona `profiles` y restringe por columna lo que un usuario
--      autenticado puede actualizar en su propia fila (perfil/preferencias,
--      nunca `role`).
--   2. Límite de tamaño para `profiles.preferences`.
--   3. Versiona `saved_artists` con RLS por dueño.
--   4. `tag_suggestions.user_id` (autor cuando hay sesión).
--   5. Retención de IPs: purga de `rate_limits` y anonimización de
--      `tag_suggestions.user_ip`, programada con pg_cron si está disponible.
--
-- ⚠️ `profiles` y `saved_artists` se reconstruyen a partir del uso en el
--    código (no hay dump). Los CREATE TABLE son IF NOT EXISTS, así que en
--    producción NO cambian la tabla existente; solo aplican en entornos nuevos.
--    Antes de correr, revisa las consultas de verificación al final.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  username    text,
  avatar_url  text,
  role        text not null default 'user',
  preferences jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_select" on public.profiles;
create policy "profiles_owner_select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Privilegios por columna: RLS decide QUÉ FILAS, los GRANT deciden QUÉ
-- COLUMNAS. Los perfiles se crean por trigger (auth → profiles) y se borran
-- vía service_role (app/actions/account.ts), así que los clientes no
-- necesitan INSERT ni DELETE.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, avatar_url, preferences, updated_at) on public.profiles to authenticated;

-- Cinturón y tirantes: aunque alguien vuelva a dar UPDATE sobre la tabla
-- entera en el futuro, `role` solo lo cambia service_role o un rol de
-- administración de la base (SQL Editor / migraciones).
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'profiles.role can only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ----------------------------------------------------------------------------
-- 2. Límite de tamaño de preferences
-- ----------------------------------------------------------------------------
-- El cliente corta en 128 KB de JSON compacto (MAX_PREFERENCES_BYTES en
-- hooks/use-preferences-sync.ts). jsonb::text añade espacios, por eso aquí el
-- tope es 256 KB: margen suficiente para que nada que el cliente acepte sea
-- rechazado, pero impide guardar megas arbitrarios. NOT VALID: no bloquea la
-- migración si ya existe alguna fila grande; aplica a escrituras nuevas.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_preferences_size_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferences_size_check
      check (preferences is null or octet_length(preferences::text) <= 262144) not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. saved_artists
-- ----------------------------------------------------------------------------
create table if not exists public.saved_artists (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          text not null,
  artist_tag        text not null,
  thumbnail_url     text,
  thumbnail_post_id integer,
  created_at        timestamptz not null default now(),
  constraint saved_artists_user_provider_tag_key unique (user_id, provider, artist_tag)
);

create index if not exists idx_saved_artists_user_created
  on public.saved_artists (user_id, created_at desc);

alter table public.saved_artists enable row level security;

drop policy if exists "saved_artists_owner_select" on public.saved_artists;
create policy "saved_artists_owner_select" on public.saved_artists
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "saved_artists_owner_insert" on public.saved_artists;
create policy "saved_artists_owner_insert" on public.saved_artists
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "saved_artists_owner_update" on public.saved_artists;
create policy "saved_artists_owner_update" on public.saved_artists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "saved_artists_owner_delete" on public.saved_artists;
create policy "saved_artists_owner_delete" on public.saved_artists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 4. tag_suggestions.user_id
-- ----------------------------------------------------------------------------
-- El código (lib/tag-suggestion-author.ts) ya escribe esta columna cuando hay
-- sesión, con fallback al formato solo-IP mientras la migración no esté
-- aplicada. ON DELETE SET NULL: borrar la cuenta conserva la sugerencia
-- (contribución a la taxonomía) pero la desvincula de la persona.
alter table public.tag_suggestions
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists idx_tag_suggestions_user_id
  on public.tag_suggestions (user_id) where user_id is not null;

-- ----------------------------------------------------------------------------
-- 5. Retención de IPs
-- ----------------------------------------------------------------------------
-- rate_limits solo necesita la ventana más larga que consulta el código
-- (30 min en suggestions.ts / feedback): 7 días es margen de sobra.
-- tag_suggestions.user_ip alimenta get_ip_reputation, así que se conserva
-- 90 días en sugerencias ya decididas y luego se anonimiza.
alter table public.tag_suggestions alter column user_ip drop not null;

create index if not exists idx_rate_limits_ip_action_created
  on public.rate_limits (ip, action, created_at);

create or replace function public.purge_stale_ip_data()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limits
   where created_at < now() - interval '7 days';

  update public.tag_suggestions
     set user_ip = null
   where user_ip is not null
     and status <> 'pending'
     and created_at < now() - interval '90 days';
$$;

revoke all on function public.purge_stale_ip_data() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-stale-ip-data', '17 4 * * *', 'select public.purge_stale_ip_data()');
  else
    raise notice 'pg_cron no está habilitado: activa la extensión (Database → Extensions) y vuelve a correr este bloque, o ejecuta select public.purge_stale_ip_data() periódicamente.';
  end if;
end $$;

-- ============================================================================
-- (Opcional) Tabla huérfana
-- ============================================================================
-- `user_preferences` solo la usaba lib/user-preferences-sync.ts (código muerto,
-- eliminado). Las preferencias viven en profiles.preferences. Tras confirmar
-- que no hay datos que rescatar:
--
-- drop table if exists public.user_preferences;

-- ============================================================================
-- Verificación (correr a mano después de aplicar)
-- ============================================================================
-- 1) Ninguna policy permisiva extra sobre profiles / saved_artists
--    (una `using (true)` sin `to service_role` anularía todo lo anterior):
--      select tablename, policyname, roles, cmd, qual, with_check
--        from pg_policies where tablename in ('profiles', 'saved_artists');
-- 2) `authenticated` solo puede actualizar esas cuatro columnas:
--      select column_name from information_schema.column_privileges
--       where table_name = 'profiles' and grantee = 'authenticated'
--         and privilege_type = 'UPDATE';
-- 3) Prueba real con un usuario normal (desde la app, en DevTools):
--      await supabase.from('profiles').update({ role: 'admin' }).eq('id', '<su id>')
--    → debe devolver error "permission denied for table profiles".
