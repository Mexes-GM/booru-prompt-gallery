# Auditoría Common-Sense Checklist — StickyMiniControlPanel

**Fecha:** 13/06/2026
**Proyecto:** Booru Prompt Gallery
**Componente:** `components/prompt-gallery/sticky-mini-control-panel.tsx` (252 líneas)
**Stack:** Next.js 15 + React 19 + shadcn/ui + Tailwind + Framer Motion
**Método:** Inspección de código fuente + contexto del parent (`prompt-gallery.tsx`)

---

## Resumen Ejecutivo

Componente bien construido con buena atención al detalle visual (glow animado, backdrop blur, safe-area inset). La integración con `AnimatePresence` es correcta para enter/exit. Sin embargo, tiene **3 problemas críticos** (falta clear button, no respeta `prefers-reduced-motion`, el popover dentro de `AnimatePresence` puede tener comportamiento errático) y varias oportunidades de mejora en feedback de usuario y optimización de animaciones.

---

## Hallazgos por Categoría

### 3. Búsqueda / Search Input (Tags to Add)

| Item | Estado | Detalle |
|------|--------|---------|
| Input visible sin scrollear | ✅ | Es el elemento principal del panel |
| Placeholder descriptivo | ✅ | `"e.g. 1girl, solo..."` — claro |
| Botón de limpiar (X) cuando hay texto | 🔴❌ | **No existe.** El usuario debe borrar manualmente carácter por carácter |
| Search debounced | ✅ | 400ms vía `DebouncedInput` |
| Contador de resultados/tags | 🟡❌ | No muestra cuántos tags se han ingresado |
| Búsqueda por tecla Enter | ✅ | Comportamiento nativo del input |

### 4. Formularios (Settings Popover)

| Item | Estado | Detalle |
|------|--------|---------|
| Labels visibles en todos los campos | ✅ | Todos los switches y selects tienen label |
| Indicador de campos requeridos | ✅ | N/A — todos son opcionales |
| Validación inline | ✅ | N/A — son toggles inmediatos |
| Submit deshabilitado mientras carga | 🟠❌ | Los switches/selects no muestran feedback de carga si la operación es async |
| Mensaje de éxito/error post-cambio | 🟠❌ | Cambiar settings no genera toast — el usuario no recibe confirmación |
| Tooltips en opciones complejas | 🟡❌ | "Simple Random" vs "Detailed Random" sin explicación de la diferencia |

### 9. Feedback / Notificaciones

| Item | Estado | Detalle |
|------|--------|---------|
| Toasts para acciones | 🟠❌ | Activar/desactivar Convert, Merge, o Variation no muestra toast |
| Indicador visual de estado activo | ✅ | Los botones cambian de color (ámbar, azul, índigo) al activarse |
| Errores con opción de reintentar | ❌ | Si `onToggleMergeMode`/`onToggleAiConvertMode` falla, no hay feedback de error |
| Confirmaciones para acciones destructivas | ✅ | N/A — ninguna acción del panel es destructiva |

### 10. Estados (Loading, Empty, Error, Success)

| Item | Estado | Detalle |
|------|--------|---------|
| Loading state en switches/buttons | 🟠❌ | Los botones no muestran spinner durante transiciones de modo |
| Error state | 🟠❌ | No hay manejo de errores si un toggle falla |
| Success state | ✅ | Cambio de color en botones activos |

### 11. General / App-wide

| Item | Estado | Detalle |
|------|--------|---------|
| Animaciones de entrada/salida | ✅ | `AnimatePresence` + spring (stiffness:200, damping:25) |
| Respeto a `prefers-reduced-motion` | 🔴❌ | **No usa `useReducedMotion`.** El glow animado y el spring corren siempre. `AiConvertStickyFooter` sí lo respeta (línea 292: `!shouldReduceMotion`). Inconsistencia entre componentes hermanos |
| Safe area inset | ✅ | `paddingTop: 'env(safe-area-inset-top, 0px)'` |
| Responsive | ✅ | `hidden sm:inline`, `flex-wrap sm:flex-nowrap` |
| Backdrop blur | ✅ | `bg-background/85 backdrop-blur-xl` con fallback `supports-[backdrop-filter]` |
| z-index correcto | ✅ | `z-[60]` (sobre los footers en `z-50`) |

---

## Hallazgos Específicos de Código

### 🔴 CRÍTICO 1: Falta clear button en Tags to Add
**Archivo:** `sticky-mini-control-panel.tsx:116-124`
**Expectativa:** Un botón X dentro del input (o al lado) que limpie el texto con un click.
**Impacto:** El usuario debe seleccionar y borrar manualmente todo el texto — fricción innecesaria en un input de uso frecuente.
**Fix:** Agregar un botón X condicional (`{addInput && <Button variant="ghost" size="icon" onClick={() => setAddInput('')}><X/></Button>}`) dentro del div contenedor.

### 🔴 CRÍTICO 2: No respeta `prefers-reduced-motion`
**Archivo:** `sticky-mini-control-panel.tsx` (todo el componente)
**Expectativa:** Usar `useReducedMotion()` de Framer Motion y deshabilitar animaciones cuando el usuario lo prefiere.
**Impacto:** Accesibilidad — usuarios con sensibilidad a movimiento experimentan el glow loop y el spring de entrada/salida sin poder desactivarlos.
**Fix:** 
```tsx
import { useReducedMotion } from "framer-motion"
const shouldReduceMotion = useReducedMotion()
// En el motion.div: transition={shouldReduceMotion ? { duration: 0 } : {...}}
// En el glow: {!shouldReduceMotion && (<div>...</div>)}
```
**Nota:** `AiConvertStickyFooter` (línea 292) ya implementa esto correctamente.

### 🔴 CRÍTICO 3: Popover dentro de AnimatePresence
**Archivo:** `sticky-mini-control-panel.tsx:76-250`
**Problema:** El `Popover` de Settings es hijo del `motion.div` animado. Cuando el usuario hace scroll up y el panel desaparece (exit animation), si el popover está abierto:
1. El `useEffect` (líneas 69-73) cierra el popover al detectar `!isVisible`
2. El popover se cierra **abruptamente** (sin animación de salida del popover) porque Radix Popover no está integrado con la animación de Framer Motion
3. Puede haber un flicker visual entre el cierre del popover y el inicio de la animación de salida
**Fix:** Mover el `Popover` fuera del `motion.div` animado, o usar `PopoverContent` con su propia animación. Alternativa: delay en el cierre para que coincida con la animación.

### 🟠 ALTO 1: Glow effect via Framer Motion loop infinito
**Archivo:** `sticky-mini-control-panel.tsx:95-105`
**Problema:** El `motion.div` del glow usa `animate` con un array de 3 `radial-gradient` que ciclan en loop infinito (`repeat: Infinity`). Esto corre **constantemente** incluso cuando el usuario no interactúa — Framer Motion recalcula y re-renderiza en cada frame de la animación.
**Fix:** Reemplazar con una animación CSS `@keyframes` — mismo efecto visual, zero JS overhead:
```css
@keyframes glow-pulse {
  0%, 100% { background: radial-gradient(circle at 50% 0%, rgba(120,119,198,0.1) 0%, transparent 50%); }
  50% { background: radial-gradient(circle at 50% 0%, rgba(120,119,198,0.15) 0%, transparent 70%); }
}
```

### 🟠 ALTO 2: Scroll listener sin optimización
**Archivo:** `prompt-gallery.tsx:468`
**Código:** `window.addEventListener('scroll', handleScroll)` — sin `{ passive: true }`.
**Impacto:** Bloquea el compositor thread en cada frame de scroll. Con `passive: true`, el browser puede optimizar.
**Fix:** `window.addEventListener('scroll', handleScroll, { passive: true })`

### 🟠 ALTO 3: Switch className con `scale-75` estático
**Archivo:** `sticky-mini-control-panel.tsx:141,145,152`
**Problema:** Los switches usan `className="scale-75"` sin transición. Al hacer toggle, el switch cambia de posición pero sin animación fluida porque el scale es fijo. Además `scale-75` reduce el área de hit — problema de accesibilidad en mobile.
**Fix:** Quitar `scale-75` y usar el tamaño default de Radix Switch, o aplicar `scale-90` con `transition-transform`.

### 🟡 MEDIO 1: Sin contador de tags en el input
El input de "Tags to Add" acepta tags separados por comas pero no muestra cuántos tags hay. Un contador "3 tags" ayudaría al usuario a entender el estado actual.

### 🟡 MEDIO 2: SelectValue placeholder = opción válida
**Archivo:** Línea 164: `<SelectValue placeholder="Keep Original" />`
El placeholder no debería ser una opción seleccionable. Si "keep" es el default, debe ser un `SelectItem` y el placeholder debería ser algo como "Select background mode".

### 🟡 MEDIO 3: Divider oculto en mobile
**Archivo:** Línea 204: `hidden sm:block` en el divider entre Settings y los botones de acción. En mobile, los botones quedan pegados sin separación visual — debería haber al menos un gap o un divider horizontal.

### 🟢 BAJO 1: Botones sin tooltip en mobile
Los botones Convert/Merge/Variation solo muestran label en `sm:inline`. En mobile solo se ve el icono, sin tooltip que explique qué hace cada uno. Agregar `Tooltip` alrededor de los botones.

### 🟢 BAJO 2: Dot verde decorativo en label
**Archivo:** Línea 112: `<span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>`
Es puramente decorativo. Debería tener `aria-hidden="true"`.

---

## Lo que SÍ está bien hecho ✅

1. **Anatomía de animación sólida** — `AnimatePresence` + spring config correcto (stiffness:200, damping:25, mass:0.8). Transiciones suaves y responsivas.
2. **Safe area inset** — `paddingTop: 'env(safe-area-inset-top, 0px)'` para notched phones. Los footers hermanos usan el paddingBottom equivalente. Consistencia correcta.
3. **Backdrop blur con fallback** — `supports-[backdrop-filter]:bg-background/85` asegura que navegadores viejos no se rompan.
4. **Estados activos con color semántico** — Convert (ámbar), Merge (azul), Variation (índigo). Paleta diferenciada y coherente con el resto de la app.
5. **Z-index layering correcto** — Panel en `z-[60]` sobre footers en `z-50`. Sin conflictos de stacking.
6. **Estructura de props plana y clara** — Sin acoplamiento innecesario. El componente recibe valores y callbacks, no lógica de negocio.
7. **Glow visual consistente** — Mismo patrón de glow border que `MergeStickyFooter` y `AiConvertStickyFooter` (aunque la implementación en JS debería migrar a CSS).
8. **Debounced input reutilizado** — Usa `DebouncedInput` (componente compartido) con 400ms de debounce, igual que el resto de la app.

---

## Resumen Cuantitativo

| Severidad | Count |
|-----------|-------|
| 🔴 Crítico | 3 |
| 🟠 Alto | 3 |
| 🟡 Medio | 3 |
| 🟢 Bajo | 2 |
| **Total** | **11** |

---

**Conclusión:** El StickyMiniControlPanel está funcionalmente completo y bien integrado con el ecosistema de la app. Los problemas críticos son accesibilidad (reduced-motion), usabilidad básica (clear button en input), y un edge case de animación (popover + exit). Las optimizaciones sugeridas (CSS keyframes para el glow, passive scroll listener, tooltips en mobile) son de bajo esfuerzo y alto retorno. El componente está listo para producción pero estas correcciones elevarían significativamente la calidad percibida.
