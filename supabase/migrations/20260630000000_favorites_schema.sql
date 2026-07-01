-- ============================================================================
-- Favorites schema — VERIFIED AGAINST PRODUCTION (audit F8, closed 2026-07-01)
-- ============================================================================
-- Fecha de creación: 2026-06-30. Verificado y corregido: 2026-07-01.
--
-- Historial:
--   v1 (2026-06-30) fue reconstruido SOLO a partir del uso en el código
--   (hooks/use-favorites-core.ts, hooks/use-booru-favorites.ts,
--    hooks/use-favorites-sync.ts, lib/api-client.ts, lib/cache-utils.ts), sin
--   comparar contra la base de datos real. v2 (este archivo) fue verificado
--   columna por columna, constraint por constraint e índice por índice contra
--   el esquema real de producción (proyecto `booru-gallery-tags`, gestionado
--   vía Vercel Marketplace) usando information_schema, pg_constraint,
--   pg_indexes, pg_policies y pg_publication_tables. Las diferencias
--   encontradas están documentadas inline donde aplica.
--
-- ⚠️ Sigue siendo una reconstrucción manual, no un `pg_dump` real (no había
--    Docker disponible para correr `supabase db dump`). Es idempotente
--    (IF NOT EXISTS / CREATE OR REPLACE) para poder correrla sin romper una
--    DB ya poblada, pero antes de aplicarla a un entorno nuevo, vuelve a
--    verificar con un dump real si es posible.
--
-- HALLAZGO PRINCIPAL DE ESTA AUDITORÍA (bug activo, no solo doc desactualizada):
--   El fix F7 (hooks/use-favorites-sync.ts) suscribe un canal Realtime a
--   cambios de `favorite_folders`, asumiendo que esta migración ya había sido
--   aplicada. EN PRODUCCIÓN, `favorite_folders` NUNCA fue añadida a la
--   publicación `supabase_realtime` (solo `favorites` está presente). F7 es
--   código muerto hasta que se corra el `ALTER PUBLICATION` al final de este
--   archivo — la sync de carpetas entre pestañas/dispositivos no funciona hoy.
-- ============================================================================

-- Requerido para gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- favorite_folders
-- ----------------------------------------------------------------------------
-- DIFERENCIAS vs. v1:
--   • user_id referencia profiles(id), NO auth.users(id) directamente. `profiles`
--     es una tabla espejo 1:1 de auth.users (id = auth.users.id), usada en
--     middleware.ts / lib/auth/authorization.ts / use-preferences-sync.ts, y no
--     tiene su propia migración versionada en este repo tampoco — está fuera
--     del alcance original de F8 pero se referencia aquí por ser una FK real.
--   • CHECK de longitud en `name` (<= 50 chars) que v1 no contemplaba.
--   • updated_at existe en producción; v1 no la tenía.
create table if not exists public.favorite_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  icon       text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint favorite_folders_name_length_check check (char_length(name) <= 50)
);

-- onConflict "user_id,name"
create unique index if not exists favorite_folders_user_id_name_key
  on public.favorite_folders (user_id, name);

-- ----------------------------------------------------------------------------
-- favorites
-- ----------------------------------------------------------------------------
-- DIFERENCIAS vs. v1:
--   • La tabla real tiene un `id uuid` como PRIMARY KEY. El (user_id, provider,
--     post_id) que el cliente usa como onConflict es un UNIQUE separado, NO
--     la PK — v1 los fusionó incorrectamente en una PK compuesta.
--   • post_id es `integer` en producción, no `bigint`.
--   • position es NOT NULL DEFAULT 0 en producción. El comentario original de
--     F2 ("nullable para filas antiguas") y el `ORDER BY position NULLS LAST`
--     en use-favorites-core.ts asumen nulls que nunca ocurren en la práctica;
--     es inofensivo (NULLS LAST es un no-op si nunca hay nulls) pero la premisa
--     de diseño era incorrecta.
--   • Los nombres de constraint reales llevan sufijo `_v2` (favorites_v2_pkey,
--     favorites_v2_user_id_provider_post_id_key), evidencia de que la tabla
--     fue creada/migrada como `favorites_v2` y luego renombrada a `favorites`
--     sin renombrar sus constraints (Postgres no lo hace automáticamente).
--   • Existe un índice GIN sobre folder_ids (no contemplado en v1) que
--     respalda los filtros por carpeta hechos en prompt-gallery.tsx.
--   • updated_at existe en producción; v1 no la tenía.
create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  provider   text not null,
  post_id    integer not null,
  folder_ids uuid[] default '{}',
  -- position se estampa como Date.now()*-1 SOLO al crear (fix F2). NOT NULL con
  -- default 0 en producción; el load ordena por position asc (nulls last es un
  -- no-op aquí porque la columna nunca es null).
  position   bigint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint favorites_user_id_provider_post_id_key unique (user_id, provider, post_id)
);

create index if not exists idx_favorites_user_v2
  on public.favorites (user_id);

create index if not exists idx_favorites_user_position
  on public.favorites (user_id, position);

create index if not exists idx_favorites_folder_v2
  on public.favorites using gin (folder_ids);

-- ----------------------------------------------------------------------------
-- booru_posts_cache  (cache COMPARTIDO de metadata de posts, sin user_id)
-- ----------------------------------------------------------------------------
-- DIFERENCIAS vs. v1:
--   • post_id es `integer` en producción, no `bigint`.
--   • La columna de refresco real es `fetched_at`, no `updated_at` (v1 asumió
--     mal el nombre). `stale_at` sigue existiendo tal cual.
--   • Hay un índice parcial sobre stale_at (WHERE stale_at IS NOT NULL) y otro
--     sobre fetched_at, ninguno contemplado en v1.
create table if not exists public.booru_posts_cache (
  provider             text not null,
  post_id              integer not null,
  file_url             text,
  large_file_url       text,
  preview_file_url     text,
  rating               text,
  score                integer default 0,
  image_width          integer default 0,
  image_height         integer default 0,
  tag_string           jsonb default '{}'::jsonb,
  tag_string_artist    text,
  tag_string_character text,
  tag_string_copyright text,
  tag_string_meta      text,
  ai_metadata          jsonb,
  fetched_at           timestamptz default now(),
  stale_at             timestamptz,
  primary key (provider, post_id)
);

create index if not exists idx_booru_posts_cache_fetched
  on public.booru_posts_cache (fetched_at);

create index if not exists idx_booru_posts_cache_stale
  on public.booru_posts_cache (stale_at) where (stale_at is not null);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- DIFERENCIAS vs. v1:
--   • Producción tiene una policy POR COMANDO (select/insert/update/delete) en
--     lugar de una sola `for all`. El efecto neto es el mismo (auth.uid() =
--     user_id), pero se refleja aquí con fidelidad.
--   • booru_posts_cache está restringida a `auth.role() = 'authenticated'`
--     para select/insert/update — v1 documentaba (incorrectamente) que era de
--     escritura/lectura pública sin restricción. Esto es una corrección de
--     seguridad respecto a lo que v1 afirmaba, no un hallazgo nuevo de riesgo:
--     producción YA es más estricta de lo que v1 creía.
--   • favorite_folders y favorites en producción tienen, además, un set de
--     policies duplicado con nombres distintos pero idéntico efecto
--     (p.ej. "Users can delete own folders" Y "favorite_folders_owner_delete"
--     ambas con auth.uid() = user_id). Es probable vestigio de un rename de
--     policies que dejó las antiguas sin eliminar. No se recrea la duplicación
--     aquí a propósito — un solo set por comando basta; si se aplica esta
--     migración sobre la DB real, considera limpiar las policies duplicadas
--     con el DROP comentado más abajo.
alter table public.favorites        enable row level security;
alter table public.favorite_folders enable row level security;
alter table public.booru_posts_cache enable row level security;

-- favorites
drop policy if exists "favorites_owner_select" on public.favorites;
create policy "favorites_owner_select" on public.favorites
  for select using (auth.uid() = user_id);

drop policy if exists "favorites_owner_insert" on public.favorites;
create policy "favorites_owner_insert" on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "favorites_owner_update" on public.favorites;
create policy "favorites_owner_update" on public.favorites
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "favorites_owner_delete" on public.favorites;
create policy "favorites_owner_delete" on public.favorites
  for delete using (auth.uid() = user_id);

-- SECURITY FIX (post-incident, 2026-07-01): esta policy debe aplicar SOLO al
-- service_role. Sin `to service_role`, Postgres la evalúa para PUBLIC (anon +
-- authenticated también), y al combinarse con OR junto a favorites_owner_select
-- (auth.uid() = user_id OR true), el resultado es `true` siempre — es decir,
-- CUALQUIER usuario autenticado podía leer/escribir las filas de TODOS los
-- usuarios. Este fue el bug que causó la fuga de favoritos entre cuentas.
drop policy if exists "favorites_service_all" on public.favorites;
create policy "favorites_service_all" on public.favorites
  for all to service_role using (true) with check (true);

-- favorite_folders
drop policy if exists "favorite_folders_owner_select" on public.favorite_folders;
create policy "favorite_folders_owner_select" on public.favorite_folders
  for select using (auth.uid() = user_id);

drop policy if exists "favorite_folders_owner_insert" on public.favorite_folders;
create policy "favorite_folders_owner_insert" on public.favorite_folders
  for insert with check (auth.uid() = user_id);

drop policy if exists "favorite_folders_owner_update" on public.favorite_folders;
create policy "favorite_folders_owner_update" on public.favorite_folders
  for update using (auth.uid() = user_id);

drop policy if exists "favorite_folders_owner_delete" on public.favorite_folders;
create policy "favorite_folders_owner_delete" on public.favorite_folders
  for delete using (auth.uid() = user_id);

-- SECURITY FIX (post-incident, 2026-07-01): ver nota en favorites_service_all
-- arriba — mismo bug, mismo fix (restringir a service_role).
drop policy if exists "favorite_folders_service_all" on public.favorite_folders;
create policy "favorite_folders_service_all" on public.favorite_folders
  for all to service_role using (true) with check (true);

-- booru_posts_cache: cache compartido, restringido a usuarios autenticados
-- (select/insert/update), más un bypass total para el service role.
drop policy if exists "bpc_select" on public.booru_posts_cache;
create policy "bpc_select" on public.booru_posts_cache
  for select using (auth.role() = 'authenticated');

drop policy if exists "bpc_insert" on public.booru_posts_cache;
create policy "bpc_insert" on public.booru_posts_cache
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "bpc_update" on public.booru_posts_cache;
create policy "bpc_update" on public.booru_posts_cache
  for update using (auth.role() = 'authenticated');

-- SECURITY FIX (post-incident, 2026-07-01): ver nota en favorites_service_all
-- arriba. booru_posts_cache no tiene user_id (es cache compartido), así que
-- aquí el bypass sin `to service_role` no filtraba datos de otros usuarios,
-- pero sí permitía a cualquier anon/authenticated escribir libremente
-- ignorando la restricción `auth.role() = 'authenticated'` de bpc_insert/update.
drop policy if exists "bpc_service_all" on public.booru_posts_cache;
create policy "bpc_service_all" on public.booru_posts_cache
  for all to service_role using (true) with check (true);

-- ============================================================================
-- (Opcional) Limpieza de policies duplicadas detectadas en producción
-- ============================================================================
-- Producción conserva un segundo set de policies con nombres "amigables"
-- (creadas antes de la convención `<tabla>_owner_<accion>`), con efecto
-- idéntico a las de arriba. Descomentar para eliminarlas tras confirmar que
-- ningún tooling externo depende de esos nombres exactos.
--
-- drop policy if exists "Users can view own folders"   on public.favorite_folders;
-- drop policy if exists "Users can insert own folders" on public.favorite_folders;
-- drop policy if exists "Users can update own folders" on public.favorite_folders;
-- drop policy if exists "Users can delete own folders" on public.favorite_folders;
-- drop policy if exists "Users can update own favorites" on public.favorites;

-- ============================================================================
-- Realtime
-- ============================================================================
-- El hook useFavoritesSync se suscribe a cambios de `favorites` (funciona hoy)
-- y de `favorite_folders` (fix F7 — NO funciona hoy porque esta línea nunca se
-- había ejecutado en producción). Este ALTER PUBLICATION es el fix real de F7;
-- todo lo demás en use-favorites-sync.ts ya estaba listo esperándolo.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'favorites'
  ) then
    alter publication supabase_realtime add table public.favorites;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'favorite_folders'
  ) then
    alter publication supabase_realtime add table public.favorite_folders;
  end if;
end $$;

-- ============================================================================
-- (Opcional) Red de seguridad en DB para el cleanup de folder_ids (F1)
-- ============================================================================
-- El fix F1 ya limpia folder_ids desde la app (hooks/use-booru-favorites.ts).
-- Este trigger es una garantía extra por si se borra una carpeta por fuera de
-- la app (SQL directo, dashboard). No está activo en producción (no apareció
-- en pg_trigger durante la verificación). Descomentar para activarlo.
--
-- create or replace function public.strip_deleted_folder_from_favorites()
-- returns trigger
-- language plpgsql
-- security definer
-- as $$
-- begin
--   update public.favorites
--      set folder_ids = array_remove(folder_ids, old.id)
--    where user_id = old.user_id
--      and old.id = any (folder_ids);
--   return old;
-- end;
-- $$;
--
-- drop trigger if exists trg_strip_deleted_folder on public.favorite_folders;
-- create trigger trg_strip_deleted_folder
--   after delete on public.favorite_folders
--   for each row execute function public.strip_deleted_folder_from_favorites();
