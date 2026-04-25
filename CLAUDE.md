# CLAUDE.md

Este archivo proporciona orientación a Claude Code (claude.ai/code) cuando trabaja con código en este repositorio.

## Comandos de Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Construir para producción
npm run build

# Ejecutar linter
npm run lint
```

## Arquitectura del Proyecto

### Estructura de Alto Nivel

Este es un proyecto Next.js 14 (App Router) que implementa una galería de prompts de imágenes para múltiples proveedores de booru (Danbooru, Aibooru, Rule34, E621, Gelbooru). La aplicación está optimizada para rendimiento y escalabilidad.

### Backend Modular (Patrón Factory + Strategy)

El sistema de proveedores de booru sigue una arquitectura modular:

- **`lib/booru/factory.ts`**: Factory que instancia el proveedor correcto según el tipo
- **`lib/booru/base.ts`**: Clase abstracta `BaseBooruProvider` que contiene la lógica común:
  - `fetchJson()`: Manejo de peticiones HTTP con reintentos y timeouts
  - `filterValidPosts()`: Filtrado de posts inválidos (videos, eliminados, sin tags)
  - `enrichPostsWithCategories()`: Enriquece posts de proveedores con tags planos (Gelbooru, Rule34) consultando Supabase para clasificar tags en artist/character/copyright

- **`lib/booru/providers/`**: Implementaciones específicas:
  - `danbooru.ts`: Proveedor principal con soporte para trending
  - `aibooru.ts`: Proveedor especializado en IA con metadatos de prompts
  - `rule34.ts`: Proveedor con autenticación opcional (API key)
  - `e621.ts`: Proveedor furry con estructura de tags diferente
  - `gelbooru.ts`: Proveedor con estructura similar a Rule34

### Gestión de Red Robusta (`SmartFetch`)

El cliente HTTP interno (`lib/network/smart-fetch.ts`) implementa:

- **Reintentos automáticos** con exponential backoff
- **Detección de rate limits** (429) con headers `Retry-After`
- **Timeouts** para evitar peticiones colgadas
- **Manejo de errores** diferenciado (4xx vs 5xx)

### Descargas Eficientes (Streaming)

El endpoint `app/api/download/route.ts` utiliza Web Streams para canalizar datos desde el origen al cliente sin cargar el archivo completo en memoria del servidor.

### Limpieza de Prompts

El módulo `lib/cleanPrompt.ts` es el corazón de la limpieza de tags:

- **Normalización**: Convierte underscores a espacios, lowercase, trim
- **Filtrado**: Elimina meta tags, URLs, números, símbolos
- **Optimización**: Combina adjetivos para el mismo sustantivo, elimina redundancias
- **Clasificación**: Ordena tags por categoría (appearance → clothing → pose → scenery → other)
- **Procesamiento de fondos**: Modo keep/remove_all/force_simple para backgrounds

### Clasificación de Tags

`lib/tag-classifier.ts` clasifica tags en categorías:

- **Clothing**: Detecta por sufijos (wear, dress, shirt, etc.)
- **Pose**: Detecta por palabras clave (standing, sitting, looking, etc.)
- **Scenery**: Detecta por palabras clave (indoors, outdoors, background, etc.)
- **Appearance**: Detecta por palabras clave (1girl, hair, eyes, etc.)
- **Other**: Default para tags no clasificados

Soporta overrides desde la base de datos para clasificaciones personalizadas.

### Detección de Conflictos de Tags

`lib/tag-conflicts.ts` contiene un diccionario de 100+ conflictos de tags:

- **Reglas de bloqueo**: Tags que se excluyen mutuamente (ej: "nude" bloquea "clothed")
- **Excepciones**: Casos donde el bloqueo no aplica (ej: "naked_apron" permite "apron")
- **Excepciones globales**: Múltiples personajes invalidan bloqueos específicos
- **Resolución**: `resolveTagConflicts()` valida tags añadidos contra tags base

### Parser de Prompts Inversos

`lib/reverse-prompt-parser.ts` procesa prompts crudos de fuentes externas:

- **Limpieza**: Elimina bloques de negative prompt y metadatos
- **Distribución de pesos**: `distributeBracketsAndSplit()` distribuye paréntesis a tags individuales
- **Clasificación**: Separa quality tags de content tags
- **Reconstrucción**: Permite reconstruir prompts con categorías selectivas

### Gestión de Preferencias de Usuario

`lib/storage.ts` y `lib/user-preferences-sync.ts` manejan preferencias:

- **LocalStorage**: Almacenamiento local con wrappers seguros
- **Supabase sync**: Sincronización de preferencias en la nube
- **Eventos**: Custom events para sincronización cross-tab
- **Keys**: Constantes centralizadas en `STORAGE_KEYS`

### Autenticación y Autorización

`lib/auth/` contiene el sistema de autenticación:

- **`authorization.ts`**: Funciones de autorización (`requireAuth`, `requireAdmin`, `requireRole`)
- **`audit.ts`**: Logging de eventos de autenticación con hash de IP
- **Roles**: `user`, `admin`, `moderator`

### Cliente API

`lib/api-client.ts` es el cliente principal para el frontend:

- **`useInfinitePosts`**: Hook SWR para paginación infinita
- **`useFavoritePosts`**: Hook para cargar favoritos (soporta múltiples proveedores)
- **`fetchBatchTagCounts`**: Batch fetching de conteos de tags
- **Procesamiento de tags**: `processTagsForAPI()` limita tags según restricciones de Danbooru

### Caché de Trends

`lib/trend-cache.ts` implementa caché de tendencias:

- **Lectura**: `getCachedTrends()` retorna null si expiró
- **Escritura**: `setCachedTrends()` actualiza con TTL de 24 horas
- **Supabase**: Usa admin client para bypass RLS

### Rate Limiting

`lib/rate-limit.ts` implementa rate limiting con Upstash Redis:

- **`getRateLimit()`**: 10 requests / 10 segundos
- **`getAuthRateLimit()`**: 5 requests / 15 minutos
- **`getMagicLinkRateLimit()`**: 3 requests / 10 minutos
- **Development**: Deshabilitado en desarrollo

### Analytics

`lib/analytics.ts` está intencionalmente vacío para mantenerse dentro de límites de Vercel Analytics (50K eventos/mes). Solo se envían pageviews automáticos.

## Patrones Importantes

### Proveedores de Booru

Cuando agregues un nuevo proveedor:

1. Crea `lib/booru/providers/nuevo-provider.ts`
2. Extiende `BaseBooruProvider`
3. Implementa `search()` con `SearchOptions`
4. Agrega el proveedor a `BooruFactory.getProvider()`
5. Actualiza `lib/constants.ts` con URLs y patrones

### Limpieza de Prompts

El flujo de limpieza es:

1. `parseTagList()` → parsea input
2. Filtrado de meta tags y noise
3. `optimizeTags()` → optimización (combinación de adjetivos, redundancias)
4. `classifyTags()` → clasificación por categoría
5. `processBackgroundTags()` → procesamiento de backgrounds (opcional)
6. Join con comas y escape de paréntesis

### Conflictos de Tags

Para agregar un nuevo conflicto:

1. Agrega a `TAG_CONFLICTS` en `lib/tag-conflicts.ts`
2. Define `blocks` array con tags bloqueados
3. Define `exceptions` object si hay excepciones
4. Usa `resolveTagConflicts()` para validar

### Preferencias de Usuario

Las preferencias se almacenan en localStorage y se sincronizan con Supabase:

- **LocalStorage**: Para acceso rápido y cross-tab
- **Supabase**: Para persistencia cross-device
- **Sync**: `UserPreferencesSync.loadAndSyncPreferences()` al login

## Constantes y Configuración

`lib/constants.ts` contiene:

- **`PROVIDER_URLS`**: URLs base de cada proveedor
- **`PROVIDER_POST_URLS`**: Patrones de URLs de posts
- **`PROVIDER_REFERERS`**: URLs de referer para peticiones API
- **`DEFAULT_BLACKLIST`**: Tags bloqueados por defecto
- **`SOCIAL_URLS`**: URLs de redes sociales

## Tipos Importantes

- **`BooruPost`**: Estructura de post de booru (`lib/booru/types.ts`)
- **`SearchOptions`**: Opciones de búsqueda (tags, page, order, limit)
- **`TrendItem`**: Item de trending (name, type, count, imageUrl, postUrl)
- **`CleanPromptOptions`**: Opciones de limpieza de prompts
- **`ClassifiedTags`**: Tags clasificados por categoría
- **`ConflictResolution`**: Resultado de resolución de conflictos

## Notas de Implementación

- **Edge Runtime**: La aplicación usa Edge Runtime para mejor rendimiento
- **SWR**: Data fetching con SWR para caché y revalidación
- **Supabase**: Backend como servicio con RLS para seguridad
- **Vercel**: Despliegue en Vercel con optimizaciones específicas
- **Streaming**: Descargas con streaming para evitar consumo de memoria
