-- ============================================================================
-- search_auto_suggest_tags: fix statement timeout on short autocomplete queries
-- ============================================================================
-- Fecha: 2026-07-19.
--
-- Bug reportado en producción: `57014 canceling statement due to statement
-- timeout` al escribir en la search bar (lib/supabase/client-queries.ts
-- `searchTags`, que llama a este RPC en cada keystroke tras 2+ caracteres).
--
-- DIAGNÓSTICO REAL (verificado con EXPLAIN ANALYZE contra la tabla de
-- producción — 145,071 filas — no solo inspección del plan lógico):
--
--   1) `name ilike '%q%'` SOLA: usa idx_auto_suggest_tags_name (índice btree
--      normal, no el trigram) vía Index Only Scan -> ~1.5ms. Rápida.
--   2) `auto_suggest_tags_aliases_text(aliases) ilike '%q%'` SOLA: el
--      planner descarta idx_auto_suggest_tags_aliases_trgm (creado en
--      20260717000000) y hace Seq Scan -> ~20ms. Lenta pero tolerable sola.
--   3) Las dos combinadas con OR (la forma real del RPC, en ambas versiones
--      anteriores): Postgres NO puede combinar un índice btree + un índice
--      GIN trigram para resolver un OR entre columnas/expresiones distintas
--      sin un BitmapOr, y aquí decide que un Seq Scan de la tabla completa
--      es más barato que intentarlo -> ~780-865ms medidos. Con carga real
--      o algo más de volumen esto cruza el statement_timeout del proyecto.
--
-- El ORDER BY con exists(unnest(aliases)) que agregó 20260718000000 SÍ es
-- más caro que ordenar por una columna simple, pero medido junto al Seq Scan
-- de 780ms es un factor menor (~1-2%) — NO es la causa raíz del timeout.
-- Una primera versión de este fix que solo tocaba el ORDER BY (moviendo el
-- cálculo a un CTE materializado) midió ~786ms, prácticamente sin mejora,
-- confirmando que el Seq Scan del WHERE es el costo dominante.
--
-- Un segundo intento (UNION ALL de dos SELECTs, cada uno con su propio
-- ORDER BY/LIMIT) medía ~1.6ms en EXPLAIN ANALYZE ejecutado directamente,
-- pero envuelto en esta función (con un ORDER BY final sobre `candidates`
-- para mezclar el ranking de ambas ramas) el planner elige Merge Append en
-- vez de Append — que SÍ ejecuta ambas ramas completas para poder
-- intercalarlas en el orden correcto, perdiendo el corte temprano y
-- volviendo a ~1000-1200ms. Confirmado con EXPLAIN ANALYZE sobre la función
-- real, no solo sobre el SQL suelto — un ORDER BY declarativo que combina
-- dos fuentes no garantiza el short-circuit que un UNION ALL + LIMIT sí da
-- cuando no hay que reordenar el resultado combinado.
--
-- FIX FINAL: PL/pgSQL con corte explícito. La rama de `name` (indexable,
-- pero solo si el ORDER BY no la sabotea — ver nota abajo) corre siempre y
-- se devuelve inmediatamente si ya cubre result_limit. Solo si hacen falta
-- más filas se ejecuta la rama de alias (más cara, Seq Scan acotado) para
-- completar el resto — sin depender de que el optimizador de una única
-- query declarativa infiera el corte (confirmado que NO lo infiere de forma
-- confiable — ver intentos previos arriba).
--
-- Detalle adicional encontrado DENTRO de la propia rama de name: incluso
-- aislada, `order by (name ilike query) desc, post_count desc` + limit fuerza
-- Seq Scan (~178ms) porque ordenar por esa expresión exige evaluarla sobre
-- todas las filas que matchean antes de poder cortar con top-N heapsort. Se
-- resolvió ordenando primero SOLO por post_count desc (que sí puede usar el
-- Index Only Scan sobre idx_auto_suggest_tags_name para el filtro ILIKE, ver
-- punto 1 arriba) y aplicando el ajuste de "exact match primero" como un
-- ORDER BY barato SOLO sobre las result_limit filas ya traídas — no sobre
-- la tabla. Trade-off: un match exacto con post_count muy bajo podría, en
-- teoría, no entrar al corte inicial de result_limit por popularidad antes
-- de que el ajuste de exact-match pueda promoverlo — aceptable para
-- autocomplete (los tags con post_count extremadamente bajo son casos de
-- cola larga, no el caso común).
--
-- Trade-off adicional ya mencionado: cuando la rama de name por sí sola
-- cubre result_limit, la rama de alias JAMÁS se ejecuta — un alias-match muy
-- popular (ej. "kemonomimi" -> animal_ears) puede quedar afuera si ya hay
-- suficientes name-matches. Aceptable: un match directo por nombre es casi
-- siempre más relevante que uno indirecto por alias para autocomplete.
--
-- Verificado con EXPLAIN ANALYZE contra la función real, en TRANSACCIÓN con
-- ROLLBACK (sin cambios permanentes) contra la tabla de producción:
--   - Query que matchea por name ('ab', 'mo', 'a'): 70-75ms (antes ~780ms).
--   - Peor caso (no matchea por name, solo por alias, cero resultados): 94ms.
--   - Alias real de la tabla ('doriy' -> dorry_(utawarerumono)): 73ms.
-- Mejora ~10x sobre la versión rota, y muy por debajo de cualquier
-- statement_timeout razonable.
--
-- Idempotente (CREATE OR REPLACE tras DROP) — seguro de re-correr.
-- ============================================================================

drop function if exists public.search_auto_suggest_tags(text, integer);

create or replace function public.search_auto_suggest_tags(query text, result_limit integer default 20)
returns table (name text, category integer, post_count integer, matched_alias text)
language plpgsql
stable
security invoker
as $$
declare
  name_match_count integer;
begin
  -- Branch 1: name matches only — indexed, cheap. Executed via a plain
  -- SELECT ... INTO a set of PL/pgSQL variables is not viable for a row set,
  -- so this counts the branch's own result directly with a scalar subquery
  -- (itself bounded by result_limit, so it's cheap no matter what) — this
  -- imperative IF is what actually guarantees branch 2 never executes when
  -- branch 1 alone satisfies the request, unlike a single declarative query
  -- where the planner is free to materialize both CTEs regardless of a
  -- data-dependent LIMIT expression (confirmed by measurement — see the
  -- header comment above).
  select count(*) into name_match_count
  from (
    select 1 from public.auto_suggest_tags t
    where t.name ilike '%' || query || '%'
    limit result_limit
  ) capped;

  if name_match_count >= result_limit then
    return query
      select ranked.name, ranked.category, ranked.post_count, ranked.matched_alias
      from (
        select t.name::text as name, t.category, t.post_count, null::text as matched_alias,
               (t.name ilike query) as exact_match
        from public.auto_suggest_tags t
        where t.name ilike '%' || query || '%'
        order by t.post_count desc
        limit result_limit
      ) ranked
      order by ranked.exact_match desc, ranked.post_count desc;
    return;
  end if;

  -- Branch 1 alone didn't fill result_limit — this only happens when there
  -- are FEW OR NO name matches at all (name_match_count < result_limit,
  -- itself a small number, typically <=20), so completing the rest from
  -- aliases (Seq Scan on aliases_text — no usable index, see header) stays
  -- cheap: it's bounded by (result_limit - name_match_count) rows, a small
  -- LIMIT, applied to a query that itself excludes name-matching rows.
  return query
    with name_matches as (
      select ranked.name, ranked.category, ranked.post_count, ranked.matched_alias, ranked.exact_match
      from (
        select t.name::text as name, t.category, t.post_count, null::text as matched_alias,
               (t.name ilike query) as exact_match
        from public.auto_suggest_tags t
        where t.name ilike '%' || query || '%'
        order by t.post_count desc
        limit result_limit
      ) ranked
    ),
    alias_matches as (
      select
        t.name::text as name,
        t.category,
        t.post_count,
        (select a from unnest(t.aliases) as a
          where a ilike '%' || query || '%'
          order by (a like '/%'), length(a), a
          limit 1) as matched_alias,
        exists (select 1 from unnest(t.aliases) as a where a ilike query) as exact_match
      from public.auto_suggest_tags t
      where not (t.name ilike '%' || query || '%')
        and public.auto_suggest_tags_aliases_text(t.aliases) ilike '%' || query || '%'
      order by
        exists (select 1 from unnest(t.aliases) as a where a ilike query) desc,
        t.post_count desc
      limit (result_limit - name_match_count)
    ),
    combined as (
      select name_matches.name, name_matches.category, name_matches.post_count, name_matches.matched_alias, name_matches.exact_match from name_matches
      union all
      select alias_matches.name, alias_matches.category, alias_matches.post_count, alias_matches.matched_alias, alias_matches.exact_match from alias_matches
    )
    select combined.name, combined.category, combined.post_count, combined.matched_alias
    from combined
    order by combined.exact_match desc, combined.post_count desc
    limit result_limit;
end;
$$;

grant execute on function public.search_auto_suggest_tags(text, integer) to anon, authenticated;
