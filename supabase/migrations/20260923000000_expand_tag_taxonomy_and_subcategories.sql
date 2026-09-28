-- ============================================================================
-- Taxonomía de 7 Categorías Base y 33 Ranuras (Slots) con Jev
-- ============================================================================
-- Fecha: 2026-09-23
-- Migración: 20260923000000_expand_tag_taxonomy_and_subcategories.sql
--
-- 1. Actualización de constraints CHECK para 7 categorías:
--    'appearance', 'clothing', 'equipment', 'pose', 'scenery', 'creature', 'other'
-- 2. Incorporación de subcategorías, confianza y estado ('approved', 'needs_review', 'pending')
-- 3. Aterrizaje formal de 'needs_review' con índices parciales optimizados
-- 4. Reclasificación determinista de los 113,061 tags no-generales (artist, copyright, character, meta)
-- 5. Inicialización de cola larga general (< 200 posts) como 'pending'
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK constraints sobre tags y tag_suggestions
-- ---------------------------------------------------------------------------
alter table public.tags
  drop constraint if exists tags_category_check;

alter table public.tags
  add constraint tags_category_check
  check (category in ('appearance', 'clothing', 'equipment', 'pose', 'scenery', 'creature', 'other'))
  not valid;

alter table public.tags
  validate constraint tags_category_check;

alter table public.tag_suggestions
  drop constraint if exists tag_suggestions_current_category_check;

alter table public.tag_suggestions
  add constraint tag_suggestions_current_category_check
  check (current_category in ('appearance', 'clothing', 'equipment', 'pose', 'scenery', 'creature', 'other'))
  not valid;

alter table public.tag_suggestions
  validate constraint tag_suggestions_current_category_check;

alter table public.tag_suggestions
  drop constraint if exists tag_suggestions_suggested_category_check;

alter table public.tag_suggestions
  add constraint tag_suggestions_suggested_category_check
  check (suggested_category in ('appearance', 'clothing', 'equipment', 'pose', 'scenery', 'creature', 'other'))
  not valid;

alter table public.tag_suggestions
  validate constraint tag_suggestions_suggested_category_check;

-- ---------------------------------------------------------------------------
-- 2. Columnas de subcategoría y aterrizaje de revisión en public.tags
-- ---------------------------------------------------------------------------
alter table public.tags
  add column if not exists subcategory varchar(32),
  add column if not exists confidence real,
  add column if not exists status varchar(16) default 'approved',
  add column if not exists proposed_category varchar(32),
  add column if not exists proposed_subcategory varchar(32);

-- ---------------------------------------------------------------------------
-- 3. Columnas de subcategoría y taxonomía en public.auto_suggest_tags
-- ---------------------------------------------------------------------------
alter table public.auto_suggest_tags
  add column if not exists category_name varchar(32),
  add column if not exists subcategory varchar(32),
  add column if not exists confidence real,
  add column if not exists status varchar(16) default 'approved',
  add column if not exists proposed_category varchar(32),
  add column if not exists proposed_subcategory varchar(32);

-- ---------------------------------------------------------------------------
-- 4. Columnas de subcategoría en public.tag_suggestions
-- ---------------------------------------------------------------------------
alter table public.tag_suggestions
  add column if not exists current_subcategory varchar(32),
  add column if not exists suggested_subcategory varchar(32),
  add column if not exists confidence real;

-- ---------------------------------------------------------------------------
-- 5. Índices de rendimiento e índices parciales para needs_review
-- ---------------------------------------------------------------------------
create index if not exists idx_tags_category_subcategory
  on public.tags(category, subcategory);

create index if not exists idx_tags_status_needs_review
  on public.tags(status) where status = 'needs_review';

create index if not exists idx_auto_suggest_tags_taxonomy
  on public.auto_suggest_tags(category_name, subcategory);

create index if not exists idx_auto_suggest_tags_status_needs_review
  on public.auto_suggest_tags(status) where status = 'needs_review';

-- ---------------------------------------------------------------------------
-- 6. Mapeo determinista inmediato para los 113,061 tags no-generales
-- ---------------------------------------------------------------------------
update public.auto_suggest_tags
set category_name = 'other',
    subcategory = 'artist',
    confidence = 1.0,
    status = 'approved'
where category = 1 and (category_name is distinct from 'other' or subcategory is distinct from 'artist');

update public.auto_suggest_tags
set category_name = 'other',
    subcategory = 'copyright',
    confidence = 1.0,
    status = 'approved'
where category = 3 and (category_name is distinct from 'other' or subcategory is distinct from 'copyright');

update public.auto_suggest_tags
set category_name = 'other',
    subcategory = 'character',
    confidence = 1.0,
    status = 'approved'
where category = 4 and (category_name is distinct from 'other' or subcategory is distinct from 'character');

update public.auto_suggest_tags
set category_name = 'other',
    subcategory = 'meta',
    confidence = 1.0,
    status = 'approved'
where category = 5 and (category_name is distinct from 'other' or subcategory is distinct from 'meta');

-- ---------------------------------------------------------------------------
-- 7. Inicialización de la cola larga general (< 200 posts) como pending
-- ---------------------------------------------------------------------------
update public.auto_suggest_tags
set category_name = 'other',
    subcategory = 'unclassified',
    confidence = 0.0,
    status = 'pending'
where category = 0 and post_count < 200 and category_name is null;
