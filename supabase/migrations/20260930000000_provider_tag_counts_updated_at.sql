-- provider_tag_counts: add a freshness timestamp.
--
-- The Worker (/api/booru/tags) caches character post counts here, but rows had
-- no timestamp, so a count — including a `0` recorded for a tag Danbooru did
-- not return — was served forever and never refreshed. With `updated_at` the
-- Worker re-fetches counts older than 30 days (7 days for zeros).
--
-- Existing rows get now() as their baseline, so the refresh spreads out over
-- the next month instead of hitting Danbooru all at once.
--
-- The table predates the migrations folder, hence `if exists`.

alter table if exists public.provider_tag_counts
  add column if not exists updated_at timestamptz not null default now();
