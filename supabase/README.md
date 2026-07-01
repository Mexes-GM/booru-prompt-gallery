# Supabase — Esquema de la base de datos

Este directorio versiona el esquema de la base de datos que antes vivía **solo**
en el proyecto Supabase remoto (hallazgo F8 de la auditoría de favoritos).

## Migraciones

| Archivo | Contenido |
|---|---|
| `migrations/20260630000000_favorites_schema.sql` | Tablas `favorites`, `favorite_folders`, `booru_posts_cache`; índices únicos que respaldan los `onConflict` del cliente; políticas RLS; y el registro en la publicación `supabase_realtime`. **Verificado contra producción el 2026-07-01** (ver abajo). |

## Estado de verificación (2026-07-01)

La versión inicial (2026-06-30) fue reconstruida **solo** a partir del uso en el
código, sin comparar contra la base de datos real. El 2026-07-01 se verificó
columna por columna, constraint por constraint, índice por índice, policy por
policy y la publicación Realtime contra el proyecto real (`booru-gallery-tags`,
gestionado vía Vercel Marketplace), usando `information_schema`, `pg_constraint`,
`pg_indexes`, `pg_policies` y `pg_publication_tables` corridos manualmente desde
el SQL Editor del dashboard (no fue posible usar `supabase db dump` — requiere
Docker, no disponible en este entorno; tampoco el MCP de Supabase — el proyecto
usa un token de integración de Vercel Marketplace, no un Personal Access Token
de Supabase, incompatible con el servidor MCP oficial y con la Management API
REST).

**Hallazgo principal — bug activo, no solo documentación desactualizada:**
`favorite_folders` nunca fue añadida a la publicación `supabase_realtime` en
producción (solo `favorites` estaba presente). El fix F7
(`hooks/use-favorites-sync.ts`) asumía que sí, y su código cliente para
sincronizar carpetas entre pestañas/dispositivos en tiempo real lleva desde su
implementación sin funcionar. La migración actualizada incluye el
`ALTER PUBLICATION` idempotente que lo corrige.

**Otras discrepancias corregidas en esta versión:**
- `favorites`: la PK real es `id uuid`, no `(user_id, provider, post_id)` — esa
  combinación es un `UNIQUE` separado. `post_id` es `integer`, no `bigint`.
  `position` es `NOT NULL DEFAULT 0`, no nullable. Existe un índice GIN sobre
  `folder_ids` no contemplado antes.
- `favorite_folders`: `user_id` referencia `profiles(id)`, no `auth.users(id)`
  directamente (`profiles` es una tabla espejo 1:1 de `auth.users`, usada en
  `middleware.ts` / `lib/auth/authorization.ts` / `use-preferences-sync.ts`, y
  tampoco tiene migración versionada en este repo — fuera del alcance de esta
  auditoría). Hay un `CHECK (char_length(name) <= 50)` no contemplado antes.
- `booru_posts_cache`: `post_id` es `integer`, no `bigint`. La columna de
  refresco real es `fetched_at`, no `updated_at`. Las policies de
  select/insert/update requieren `auth.role() = 'authenticated'` — v1
  documentaba (incorrectamente) que el acceso era público sin restricción; la
  realidad es más segura de lo que se pensaba, no menos.
- Producción tiene, además, un segundo set de policies con nombres "amigables"
  duplicando el efecto de las policies `<tabla>_owner_<accion>` (vestigio de un
  rename histórico). No se recrea la duplicación; el archivo incluye un bloque
  comentado para limpiarlas si se decide aplicar la migración a producción.

## Cómo aplicarlo

Con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase db push
```

O pegando el contenido del `.sql` en el SQL Editor del dashboard.

> ⚠️ Este proyecto está conectado vía **Vercel Marketplace**. `supabase link`
> funciona con el token de integración de Vercel, pero `supabase db dump`
> requiere Docker Desktop corriendo localmente (usa un contenedor `pg_dump`
> pinneado a la versión exacta de Postgres del proyecto) — no hay bandera para
> evitarlo. Si necesitas volver a exportar el esquema real sin Docker, corre
> las consultas de `information_schema` / `pg_catalog` manualmente en el SQL
> Editor (ver sección de verificación arriba para los nombres de tabla
> relevantes).

## Puntos ya confirmados (no requieren re-verificación salvo cambios futuros)

- Índice único en `favorites (user_id, provider, post_id)` — respalda el
  upsert de `toggleFavorite`. ✅ Confirmado (`favorites_v2_user_id_provider_post_id_key`).
- Índice único en `favorite_folders (user_id, name)` — requerido por
  `createFolder`. ✅ Confirmado.
- Índice único / PK en `booru_posts_cache (provider, post_id)`. ✅ Confirmado.
- RLS activa en las tres tablas, restringida al dueño (`auth.uid() = user_id`)
  en `favorites`/`favorite_folders`, y a usuarios autenticados en
  `booru_posts_cache`. ✅ Confirmado.
- `favorites` presente en la publicación `supabase_realtime`. ✅ Confirmado.
- `favorite_folders` presente en la publicación `supabase_realtime`.
  ❌ **No confirmado — corregido en esta migración, pendiente de aplicar a producción.**
