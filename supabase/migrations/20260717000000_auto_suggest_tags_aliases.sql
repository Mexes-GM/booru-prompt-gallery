-- ============================================================================
-- auto_suggest_tags: add aliases + post_count, trigram search indexes
-- ============================================================================
-- Fecha: 2026-07-17.
--
-- Contexto (feedback de usuario): el autocompletado de búsqueda
-- (lib/supabase/client-queries.ts `searchTags`) consulta esta tabla con
-- `ILIKE '%query%'` sobre `name` únicamente. Tags que existen en Danbooru
-- pero no fueron minados por la herramienta admin (generateAutoSuggestions,
-- que solo procesa ~10 tags nuevos por click desde posts random:5) nunca
-- aparecen como sugerencia — ej. un tag que en Danbooru es un ALIAS de otro
-- tag canónico, no un tag independiente, nunca resolvía a ese canónico.
--
-- Este archivo agrega las dos columnas que hacían falta para resolver esto
-- con un import masivo desde un dataset externo (formato tagcomplete:
-- name,category,post_count,"alias1,alias2,..."), SIN cambiar el significado
-- de `category` (sigue siendo el esquema numérico de Danbooru: 0=general,
-- 1=artist, 3=copyright, 4=character, 5=meta) — lib/booru/base.ts
-- `enrichPostsWithCategories` depende de esos valores exactos para
-- Gelbooru/Rule34, así que category no se toca.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE) — seguro de re-correr.
-- ============================================================================

-- Requerido para búsqueda por similitud (gin_trgm_ops) usada por ILIKE '%x%'
-- sobre 140k+ filas. Sin esto, ILIKE con wildcard al inicio no puede usar
-- índice y cae a sequential scan.
create extension if not exists "pg_trgm";

-- ----------------------------------------------------------------------------
-- Columnas nuevas
-- ----------------------------------------------------------------------------
-- aliases: nombres alternativos/sinónimos que Danbooru resuelve al tag
-- canónico. El autocomplete debe matchear tanto `name` como cualquier
-- elemento de `aliases`.
alter table public.auto_suggest_tags
  add column if not exists aliases text[] not null default '{}';

-- post_count: volumen de posts en Danbooru para ese tag. Permite ordenar
-- las sugerencias por relevancia/popularidad en lugar del orden de inserción.
alter table public.auto_suggest_tags
  add column if not exists post_count integer not null default 0;

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------
-- Trigram GIN sobre name: acelera `ILIKE '%query%'` (wildcard en ambos lados),
-- que un índice btree normal no puede usar.
create index if not exists idx_auto_suggest_tags_name_trgm
  on public.auto_suggest_tags using gin (name gin_trgm_ops);

-- array_to_string() no está marcada IMMUTABLE por Postgres para uso directo
-- en un índice de expresión ("functions in index expression must be marked
-- IMMUTABLE"), así que se envuelve en una función propia que sí lo declara
-- explícitamente — es determinística de verdad (mismo array + separador
-- siempre produce el mismo string), por lo que la marca es segura.
create or replace function public.auto_suggest_tags_aliases_text(aliases text[])
returns text
language sql
immutable
as $$
  select array_to_string(aliases, ' ');
$$;

-- Trigram GIN sobre aliases: aliases es text[], así que se indexa el texto
-- concatenado para poder buscar substring dentro de cualquier alias vía ILIKE.
create index if not exists idx_auto_suggest_tags_aliases_trgm
  on public.auto_suggest_tags using gin (public.auto_suggest_tags_aliases_text(aliases) gin_trgm_ops);

-- Acelera ORDER BY post_count DESC en el ranking de sugerencias.
create index if not exists idx_auto_suggest_tags_post_count
  on public.auto_suggest_tags (post_count desc);

-- ----------------------------------------------------------------------------
-- search_auto_suggest_tags: RPC de búsqueda name OR aliases
-- ----------------------------------------------------------------------------
-- PostgREST no permite aplicar ILIKE sobre una expresión (array_to_string)
-- dentro de un filtro .or() desde el cliente JS, así que la búsqueda
-- combinada vive en una función SQL invocada vía supabase.rpc(...) desde
-- lib/supabase/client-queries.ts `searchTags`.
--
-- SECURITY INVOKER (no DEFINER): corre con los privilegios de quien la llama
-- (el cliente anon en el browser), igual que el SELECT directo que reemplaza
-- — no eleva privilegios ni sortea RLS.
create or replace function public.search_auto_suggest_tags(query text, result_limit integer default 20)
returns table (name text, category integer, post_count integer)
language sql
stable
security invoker
as $$
  select t.name, t.category, t.post_count
  from public.auto_suggest_tags t
  where t.name ilike '%' || query || '%'
     or public.auto_suggest_tags_aliases_text(t.aliases) ilike '%' || query || '%'
  order by t.post_count desc
  limit result_limit;
$$;

grant execute on function public.search_auto_suggest_tags(text, integer) to anon, authenticated;
