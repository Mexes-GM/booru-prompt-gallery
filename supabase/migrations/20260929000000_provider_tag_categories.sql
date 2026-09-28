-- ============================================================================
-- provider_tag_categories: categorías de tags propias de cada provider
-- ============================================================================
-- Fecha: 2026-09-29.
--
-- Contexto
-- --------
-- Rule34 (y Gelbooru) no devuelven la categoría de cada tag en el post, así que
-- el Worker la resuelve contra `auto_suggest_tags` (vocabulario de Danbooru) en
-- `BaseBooruProvider.enrichPostsWithCategories`. Todo tag que Danbooru no
-- conoce (artistas de Rule34, tags inventados, metadata propia como
-- `koikatsu_(medium)` o `patreon_username`) se quedaba sin categoría y llegaba
-- al prompt como contenido.
--
-- Esta tabla guarda la categoría de esos tags, precalculada offline por
-- scripts/classify-rule34-tags.ts (tipo del propio provider + heurística + Jev).
-- El Worker la consulta solo para los tags que `auto_suggest_tags` no resuelve:
-- Danbooru siempre tiene prioridad.
--
-- `category` usa la numeración de Danbooru para que el Worker la reparta igual:
--   0 general (contenido, se guarda para no reclasificarlo), 1 artista,
--   3 copyright, 4 personaje, 5 meta.
--
-- `name` se guarda con la grafía del provider (minúsculas, guiones bajos,
-- entidades HTML decodificadas), que es lo que `toProviderSpelling` produce.
--
-- Solo el service role la lee y escribe (Worker y script), así que RLS queda
-- activado sin políticas y sin grants para anon/authenticated.

create table if not exists public.provider_tag_categories (
  provider           text        not null,
  name               text        not null,
  category           smallint    not null check (category in (0, 1, 3, 4, 5)),
  source             text        not null check (source in ('provider_type', 'heuristic', 'jev', 'manual')),
  status             text        not null default 'approved' check (status in ('approved', 'needs_review')),
  confidence         real,
  proposed_category  smallint    check (proposed_category in (0, 1, 3, 4, 5)),
  post_count         integer,
  updated_at         timestamptz not null default now(),
  primary key (provider, name)
);

comment on table public.provider_tag_categories is
  'Categoría (numeración Danbooru) de tags de providers sin categorías fiables. Generada por scripts/classify-rule34-tags.ts. Las filas source=manual no se sobrescriben.';

alter table public.provider_tag_categories enable row level security;

revoke all on table public.provider_tag_categories from anon, authenticated;
