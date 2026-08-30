-- ============================================================================
-- tags / auto_suggest_tags: cerrar la escritura y restringir category
-- ============================================================================
-- Fecha: 2026-08-27.
--
-- Contexto
-- --------
-- `public.tags` es la tabla de overrides de categoría que alimenta
-- `classifyTag` (vía getAllTagOverridesClient). Al auditarla tenía 2191 filas,
-- de las cuales 670 (30.6%) eran nombres de artista y meta tags de Danbooru,
-- inertes como override: un nombre de artista no puede mejorar un prompt, y los
-- meta tags los descarta `cleanPrompt` antes de que la clasificación corra.
-- Esa basura se purgó por separado; esta migración evita que vuelva.
--
-- Se encontraron tres agujeros:
--
--   1) RLS permitía escritura a CUALQUIER usuario logueado. Las políticas
--      permisivas de Postgres se combinan con OR, así que la política de admin
--      quedaba anulada por una mucho más laxa:
--
--        [INSERT] Admins can insert tags
--            check = EXISTS (SELECT 1 FROM profiles
--                            WHERE id = auth.uid() AND role = 'admin')
--        [INSERT] tags_auth_insert
--            check = (auth.role() = 'authenticated')     <-- gana esta
--        [UPDATE] tags_auth_update
--            qual  = (auth.role() = 'authenticated')     <-- y esta
--
--      Es decir: cualquier cuenta autenticada podía reclasificar toda la
--      taxonomía, o insertar filas arbitrarias.
--
--   2) `anon` y `authenticated` tenían grants crudos de INSERT/UPDATE/DELETE/
--      TRUNCATE/REFERENCES/TRIGGER sobre ambas tablas. DELETE quedaba frenado
--      por RLS (no hay política de DELETE) y TRUNCATE no es alcanzable vía
--      PostgREST, pero son permisos que ninguna ruta necesita.
--
--   3) `tags.category` es `character varying` SIN ningún CHECK ni enum, así que
--      la base aceptaba cualquier string. `classifyTag` filtra el valor contra
--      un whitelist literal en TypeScript, así que una categoría inválida no
--      explota: se descarta en silencio y el tag se reclasifica por heurística.
--      Un override roto que no avisa es peor que un error.
--
-- Seguridad de este cambio
-- ------------------------
-- Se verificó que TODA escritura a `tags` pasa por `supabaseAdmin` (service
-- role, que bypassea RLS y tiene sus propios grants):
--   - app/actions/suggestions.ts       (flujo Teach del usuario)
--   - app/actions/auto-suggestions.ts  (minería, admin)
--   - app/actions/admin.ts             (aprobar/rechazar sugerencias)
-- El único acceso con la anon key es un SELECT en lib/supabase/client-queries.ts
-- (getAllTagOverridesClient). Por eso revocar la escritura de anon/authenticated
-- no rompe ninguna ruta.

-- ---------------------------------------------------------------------------
-- 1. Quitar las políticas permisivas que anulaban la restricción de admin
-- ---------------------------------------------------------------------------
drop policy if exists tags_auth_insert on public.tags;
drop policy if exists tags_auth_update on public.tags;

-- Las de admin y las de service_role se conservan tal cual:
--   "Admins can insert tags", "Admins can update tags",
--   tags_service_insert, tags_service_update.
-- La lectura pública tampoco se toca: "Public tags are viewable by everyone"
-- y tags_public_select siguen con qual = true, que es lo que necesita
-- getAllTagOverridesClient con la anon key.

-- ---------------------------------------------------------------------------
-- 2. Revocar grants de escritura que ninguna ruta usa
-- ---------------------------------------------------------------------------
-- Deja SELECT intacto (lo necesitan el autocomplete y los overrides).
revoke insert, update, delete, truncate, references, trigger
  on public.tags from anon, authenticated;

-- auto_suggest_tags es data de referencia de solo lectura: se importa por script
-- con el service role (scripts/import-auto-suggest-tags.js), nunca desde el
-- cliente.
revoke insert, update, delete, truncate, references, trigger
  on public.auto_suggest_tags from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. CHECK sobre tags.category
-- ---------------------------------------------------------------------------
-- Las 5 categorías que `TagCategory` (lib/tag-classifier.ts) reconoce. Si más
-- adelante se amplía la taxonomía, este constraint es el recordatorio de que hay
-- que tocar ambos lados: el whitelist de classifyTag y esta lista.
--
-- NOT VALID a propósito: valida toda escritura futura sin exigir un full scan
-- que bloquee la tabla. Se valida a continuación, que sobre 1468 filas es
-- instantáneo; queda separado para que la validación se pueda reintentar sola si
-- llegara a fallar.
alter table public.tags
  drop constraint if exists tags_category_check;

alter table public.tags
  add constraint tags_category_check
  check (category in ('clothing', 'pose', 'scenery', 'appearance', 'other'))
  not valid;

alter table public.tags
  validate constraint tags_category_check;

-- Mismo criterio para las dos columnas de categoría de tag_suggestions, que
-- tampoco tenían restricción (solo `status` la tenía).
alter table public.tag_suggestions
  drop constraint if exists tag_suggestions_current_category_check;

alter table public.tag_suggestions
  add constraint tag_suggestions_current_category_check
  check (current_category in ('clothing', 'pose', 'scenery', 'appearance', 'other'))
  not valid;

alter table public.tag_suggestions
  validate constraint tag_suggestions_current_category_check;

alter table public.tag_suggestions
  drop constraint if exists tag_suggestions_suggested_category_check;

alter table public.tag_suggestions
  add constraint tag_suggestions_suggested_category_check
  check (suggested_category in ('clothing', 'pose', 'scenery', 'appearance', 'other'))
  not valid;

alter table public.tag_suggestions
  validate constraint tag_suggestions_suggested_category_check;
