-- ============================================================================
-- search_auto_suggest_tags: surface WHICH alias matched (UX feedback)
-- ============================================================================
-- Fecha: 2026-07-18.
--
-- Contexto: tras la migración 20260717000000 (aliases + post_count), el
-- feedback de usuario reportó que buscar un término alternativo mostraba
-- directamente el tag canónico sin ninguna indicación de que el término
-- tipeado era un alias — confuso, porque el usuario no ve relación entre
-- lo que escribió y lo que aparece. Esta migración reemplaza el RPC para
-- que también devuelva `matched_alias`: el alias exacto (case-insensitive)
-- que causó el match, o NULL si el match fue directo por `name`. El
-- cliente (searchTags / SearchWithAutocomplete) usa esto para renderizar
-- "alias -> tag canónico" en vez de solo el tag canónico.
--
-- También reordena el ranking: un match directo de `name` (o un alias que
-- coincide EXACTO con la query) ahora se antepone a post_count, para que un
-- alias exacto no quede enterrado bajo un tag más popular que solo matchea
-- por substring parcial.
-- Idempotente (CREATE OR REPLACE) — seguro de re-correr.
-- ============================================================================

-- Postgres no permite CREATE OR REPLACE cuando cambia la lista de columnas
-- devueltas por una función que retorna TABLE (aquí se agrega matched_alias
-- a la firma anterior name/category/post_count) — hay que dropearla primero.
drop function if exists public.search_auto_suggest_tags(text, integer);

create or replace function public.search_auto_suggest_tags(query text, result_limit integer default 20)
returns table (name text, category integer, post_count integer, matched_alias text)
language sql
stable
security invoker
as $$
  select
    t.name,
    t.category,
    t.post_count,
    -- Only surface an alias when the match did NOT already come from `name`
    -- itself (e.g. a query matching a tag's own name exactly should never
    -- show a redundant "alias -> same name" hint — that's a name match, not
    -- an alias resolution). Among multiple matching aliases, prefer the
    -- shortest one that doesn't start with a shorthand slash (e.g.
    -- "/blondeh") — those are compact power-user shortcuts from the source
    -- dataset, not readable words, and a longer-but-legible alias is a far
    -- better UX hint than a cryptic slash-prefixed shortcut.
    case
      when t.name ilike '%' || query || '%' then null
      else (
        select a
        from unnest(t.aliases) as a
        where a ilike '%' || query || '%'
        order by (a like '/%'), length(a), a
        limit 1
      )
    end as matched_alias
  from public.auto_suggest_tags t
  where t.name ilike '%' || query || '%'
     or public.auto_suggest_tags_aliases_text(t.aliases) ilike '%' || query || '%'
  order by
    -- Exact matches (on name or on the matched alias) first, regardless of
    -- popularity — an exact hit is a stronger signal than raw post_count.
    (t.name ilike query or exists (
      select 1 from unnest(t.aliases) as a where a ilike query
    )) desc,
    t.post_count desc
  limit result_limit;
$$;

grant execute on function public.search_auto_suggest_tags(text, integer) to anon, authenticated;
