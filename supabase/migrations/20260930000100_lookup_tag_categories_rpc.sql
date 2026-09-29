-- lookup_tag_categories: resolve many tag names in ONE request.
--
-- The Worker classifies every Gelbooru/Rule34 page (~1-2k distinct tags, ~3
-- spellings each) against auto_suggest_tags and provider_tag_categories. With
-- PostgREST GET `in` filters of 100 names that was dozens of requests per page,
-- which blew through Cloudflare's 50-subrequests-per-invocation limit and made
-- /api/posts?provider=rule34 fail with 500. One POST per table fixes it.
--
-- p_provider NULL  → auto_suggest_tags (Danbooru taxonomy)
-- p_provider set   → provider_tag_categories for that provider (approved, non-zero)

create or replace function public.lookup_tag_categories(
  p_names text[],
  p_provider text default null
)
returns table (name text, category integer)
language sql
stable
security invoker
set search_path = public
as $$
  select t.name::text, t.category::integer
  from public.auto_suggest_tags t
  where p_provider is null
    and t.name = any(p_names)
  union all
  select p.name, p.category::integer
  from public.provider_tag_categories p
  where p_provider is not null
    and p.provider = p_provider
    and p.status = 'approved'
    and p.category <> 0
    and p.name = any(p_names)
$$;

revoke all on function public.lookup_tag_categories(text[], text) from public, anon, authenticated;
grant execute on function public.lookup_tag_categories(text[], text) to service_role;
