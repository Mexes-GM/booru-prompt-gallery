# Auditoría móvil — 2026-09-29

Fuentes: PostHog (últimos 30 días, API HogQL + 11 grabaciones rrweb móviles reproducidas localmente), producción (`booru-prompt-gallery.vercel.app`) con Playwright en un contexto táctil de 360×640, y lectura de código.

## Contexto en cifras

| | Móvil | Escritorio |
|---|---|---|
| Sesiones (30 d) | 524 | 3233 |
| % sesiones que copian un prompt | **11,1 %** | 14,8 % |
| % sesiones que cargan más resultados | **21,2 %** | 29,8 % |
| CLS p75 | **0,174** (48 cargas > 0,1, media 0,234) | 0,073 |
| INP p75 | 272 ms | 272 ms |
| LCP p75 | 1,68 s | 1,70 s |

Anchos más comunes: 384, 360, 390, 402 y 414 px. En Android, la altura visible oscila de forma continua entre 632 y 754 px (la barra de URL se muestra y se oculta), y cae a unos 584 px en la primera carga.

---

## P0 — Bloquean o frustran la tarea principal

### 1. La pila de FAB tapa los controles de las tarjetas de la columna derecha
- `components/prompt-gallery/floating-action-buttons.tsx:37`: `fixed bottom-4 right-4`, 40×144 px, `z-50`.
- En Playwright, al recorrer los primeros 6000 px, tapa **32 veces "Copy options" (▾)** y **32 veces "More actions" (…)**. Se ve en `shots/07-expanded-settled.png` y `shots/08-after-copy.png`.
- En las grabaciones aparecen toques a "Enable AI Mode" seguidos de otro para deshacerlo (sesión `01a0ee29`, 263 s y 264 s), y toques repetidos a "Copy options" (380, 384 y 386 s).
- Arreglo: por debajo de 640 px, quitar los FAB de AI y Merge (Merge ya existe en el selector Browse/Merge/Pack) y dejar solo "volver arriba", que aparezca al hacer scroll hacia arriba. Como mínimo, añadir `pr-14` al grid en móvil. Añadir también `env(safe-area-inset-bottom)` a `bottom`.

### 2. El buscador queda fuera de la primera pantalla
- El input de búsqueda está en y = 648 px. Un viewport real de Android deja visibles 584–632 px, así que el usuario solo ve el hero y la demo animada (`shots/01-first-load.png`).
- En la primera visita, además, sale el modal de bienvenida encima.
- Arreglo: en móvil, compactar el hero (título en una línea y la demo dentro de un desplegable "Cómo funciona") y subir el panel de búsqueda al primer viewport.

### 3. El input de búsqueda usa 14 px y provoca zoom automático en iOS
- `components/ui/placeholders-and-vanish-input.tsx:260`: `text-sm sm:text-base`. iOS hace zoom en cualquier input por debajo de 16 px, lo que descoloca el layout y obliga a hacer pinch para volver.
- Arreglo: `text-base` sin breakpoint. Revisar también los inputs de los modales.

### 4. El overlay del tour atrapa al usuario
- Sesión `01a079ab` (Chrome iOS): **12 toques en 75 s sobre el SVG del overlay de react-joyride**, sin llegar a pulsar Next, Skip ni la ✕. Esa versión tenía unos 11 pasos.
- En la versión actual (6 pasos con "Not now"), tocar el overlay sigue sin cerrar el tour (comprobado).
- "Skip" se pulsa en 42 sesiones y "Next" en 28: la mayoría de usuarios móviles no quiere el tour.
- Arreglo: permitir cerrar tocando el overlay (`disableOverlayClose={false}`). En móvil, plantearse no abrirlo automáticamente y ofrecerlo como chip.

### 5. Bucle de `replaceState` en iOS Safari — investigado el 2026-09-29
**Alcance real:** 3 sesiones (`01a05bd6`, `01a05bda`, `01a05bdd`) del **2026-09-01 entre 07:19 y 07:27 UTC**, iOS 18.7 y Safari 26.1, con 1226, 288 y 161 cambios de URL. Cada sesión tiene un ID anónimo distinto en solo 8 minutos, lo que apunta a un almacenamiento que no persistía (navegación privada o un bloqueador). **Ninguna de las otras 13 sesiones iOS muestreadas (del 02-09 al 29-09) presenta el problema.**

**Qué se descartó:**
- Varias pestañas mezcladas en la grabación: cada una tiene un solo `windowId`.
- Server actions o peticiones RSC que reescriban la URL: solo hay 2 peticiones de navegación inicial.
- Otros escritores en el código del 01-09 (commit 7dfc92b): el único es `hooks/use-booru-search.ts`.
- Un artefacto de PostHog: `$url_changed` lee `window.location.href` en cada evento de rrweb, así que las alternancias son reales. Solo se *observan* cuando hay actividad (toques o mutaciones).

**Qué está confirmado.** Reproducido en WebKit (Safari 26.0) con Playwright contra el servidor de desarrollo:
1. **Al cargar con `?tags=…`, la app borra `?tags` y lo vuelve a poner.** `debouncedSearchTags` arranca en `""`, así que el efecto de sincronización (`use-booru-search.ts:293`) hace `replaceState('/')` hacia los 750 ms y `replaceState('?tags=…')` unos 500 ms después. Eso explica por qué el primer evento `META` de la grabación registra `/` aunque la página se cargó con `?tags`.
2. **El router de Next.js queda desincronizado.** La llamada pasa `window.history.state`, que lleva la marca `__NA` de Next. El `replaceState` parcheado por Next (`next/dist/client/components/app-router.js:268`) la trata como interna y **no actualiza `canonicalUrl` ni `useSearchParams`**. Cualquier actualización posterior del estado del router (`HistoryUpdater`) reescribe la URL con el `canonicalUrl` antiguo, así que hay dos escritores que pueden pisarse.

**Qué no se pudo reproducir:** la alternancia continua. Con Rule34, escribiendo en el buscador y haciendo scroll, WebKit solo registra 4 llamadas a `replaceState`, todas explicables. La causa exacta del bucle del 01-09 sigue sin confirmar: sin almacenamiento persistente parece un entorno particular de ese usuario.

**Arreglo propuesto:**
- (a) Inicializar `debouncedSearchTags` con el valor inicial de búsqueda, para no borrar `?tags` al montar.
- (b) Añadir un cortacircuitos: si hay más de 20 `replaceState` en 10 s, dejar de sincronizar la URL en esa sesión y enviar un evento a PostHog con la traza de la pila, para diagnosticarlo si vuelve a pasar.
**Estado (2026-09-29):** (a) y (b) están aplicados en `hooks/use-booru-search.ts`, y el evento es `url_sync_loop_detected` (`lib/analytics.ts`). En WebKit, cargar con `?tags=` ya no produce ningún cambio de URL, y tras 25 escrituras forzadas la sincronización se detiene. Queda pendiente comprobar el envío del evento en una preview de Vercel, porque en `localhost` PostHog está desactivado.
- (c) Opcional: llamar a `replaceState(null, '', url)` para que Next se sincronice. Contrapartida: `PostHogPageView` depende de `useSearchParams` y emitiría un `$pageview` por cada búsqueda.

---

## P1 — Hacen incómodo el uso diario

### 6. Objetivos táctiles demasiado pequeños
**139 de 156** elementos interactivos miden menos de 44 px y **80 miden menos de 32 px**. Los peores casos:

| Elemento | Tamaño | Evidencia |
|---|---|---|
| Chips de tag (popover de peso) | ~18 px de alto | Uso constante; toques fallidos |
| "View original post" | 25×36 | 12 toques en una sesión |
| Copy options ▾ / More actions … | 32–34×35 / 32×32 | Toques repetidos |
| Iconos de info y ✕ de cierre (SVG) | 16 px | 32 toques a `svg.lucide-x`, 14+ a `lucide-info` |
| Pestañas de la demo, enlaces del header | 18–24 px de alto | |

Arreglo: ampliar el área de toque con `::after { inset: -8px }` o `min-h-11 min-w-11` en los botones de icono sin cambiar su aspecto visual.

### 7. El feedback de copia es triple y bloquea
- Al copiar aparecen a la vez un toast arriba (tapa la primera fila), un overlay "COPIED" sobre toda la tarjeta y el cambio de texto del botón (`shots/08-after-copy.png`).
- Sesión `01a0ee29`: **6 toques sobre "Close success overlay"** (350–433 s). El usuario quería usar el ▾ que quedaba debajo.
- Arreglo en móvil: dejar solo el estado del botón, añadir `navigator.vibrate(10)` en Android, darle `pointer-events-none` al overlay (o quitarlo) y suprimir o mover el toast abajo.

### 8. "Right-click to copy" no tiene equivalente táctil fiable
- `components/prompt-gallery/interactive-prompt.tsx:278-292` depende de `onContextMenu`. iOS no lo dispara de forma consistente con pulsación larga y `select-text` abre la selección de texto. El `aria-label` y el `title` dicen "Right-click".
- Arreglo: detectar pulsación larga con pointer events (~450 ms), añadir `-webkit-touch-callout:none; user-select:none` en `(pointer: coarse)` y cambiar el texto según el dispositivo.

### 9. Tocar la imagen expande la tarjeta encima de la columna vecina
- La tarjeta expandida pasa a `z-40` y `contain: none` (`components/masonry-grid.tsx:113-116`) y se superpone a la otra columna (`shots/07-expanded-settled.png`).
- Hay 96 toques a imágenes en 28 sesiones, y los usuarios salen con "View original post" (50 `external_link_clicked` en 20 sesiones) para ver la imagen completa.
- Arreglo en móvil: abrir un visor a pantalla completa o bottom sheet con la imagen, el prompt y un botón Copy fijo abajo.

### 10. Modales con `vh` en vez de `dvh`
`quick-teach-modal.tsx:483` (`h-[85vh]`), `quick-review-modal.tsx:410` (`h-[80vh]`), `reverse-prompt-parser-modal.tsx:206` (`calc(100vh-140px)`), `quick-flow-modal.tsx:78` y `pack-source-modal.tsx:143` (`max-h-[90vh]`). Con la barra de URL visible, los botones inferiores quedan fuera de pantalla. Cambiar a `dvh`.

### 11. "Try Again" y "Retry" provocan rage clicks
13 toques en cada uno, repartidos en 1–2 sesiones. Los errores de fondo son `Failed to fetch data`, `ChunkLoadError` (ya mitigado en d281cea) y fallos de fetch contra e621 y danbooru. El botón no muestra estado de carga ni cambia nada visible. Arreglo: spinner, desactivar el botón mientras reintenta y mostrar un mensaje distinto tras el segundo fallo.

---

## P2 — Pulido y medición

- **CLS 0,174 en móvil**: no se reproduce en emulación (0 shifts), así que es probable que venga de dispositivos reales (cambios de altura del viewport, imágenes o fuentes tardías). PostHog no guarda atribución (`largestShiftTarget` vacío en las 48 cargas). Recomendación: enviar la atribución de web-vitals para localizarlo.
- **INP**: 61 interacciones por encima de 200 ms (media 376 ms), también sin atribución.
- La demo animada del hero sigue cambiando de pestaña mientras el usuario hace scroll y los textos se superponen durante la transición. Conviene pausarla fuera del viewport y con `prefers-reduced-motion`.
- 12 elementos solo se muestran con hover (`opacity-0` + `group-hover:opacity-100`, pastillas `bg-overlay/65`). En táctil son invisibles; hay que mostrarlos con `(hover: none)`.
- Varias sesiones usan Google Translate (`<font>` anidados en los nodos). Conviene poner `translate="no"` en los tags y prompts para que no se traduzcan.

## Orden sugerido
1. #3 (una línea) y #1 (FAB) → 2. #4 (tour) y #7 (feedback de copia) → 3. #2 (hero compacto) y #6 (áreas táctiles) → 4. #5 (investigar el bucle) → 5. #9 (visor), #8 (pulsación larga), #10 y #11 → 6. Atribución de web-vitals.
