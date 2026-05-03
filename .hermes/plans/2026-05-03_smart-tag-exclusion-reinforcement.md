# Plan: Agente de Análisis y Refuerzo del Smart Tag Exclusion

**Fecha**: 2026-05-03  
**Objetivo**: Crear un agente/script especializado que analice exhaustivamente todas las combinaciones posibles de tags para detectar gaps, falsos positivos, y oportunidades de refuerzo en el diccionario `TAG_CONFLICTS` de `lib/tag-conflicts.ts`.

---

## Contexto Actual

### Diccionario existente (~80 triggers, 951 líneas)

| Categoría | Triggers | Ejemplos de conflictos pendientes |
|-----------|----------|-----------------------------------|
| Character count/gender | 10 | `1girl`/`1boy` no cubren `1other` ni tags de género no binario |
| Camera angles/framing | 12 | `dutch_angle`, `worm's-eye view`, `bird's-eye view`, `panoramic` sin cubrir |
| Clothing/wearables | 22 | `armor` ↔ `nude` sin definir; `swimwear` variantes; `cosplay` |
| Poses/posture | 17 | `upside-down`, `handstand`, `spread_eagle`, `legs_up` |
| Hair/physical attributes | 24 | `bald` ↔ hair tags no definido; `ahoge`, `hair_bow` |
| Facial expressions | 18 | `surprised`, `shocked`, `embarrassed`, `nervous` |
| Environment/setting | 18 | `space` ↔ `sky`; `cave` ↔ `outdoors`; `ruins` |
| Actions/states | 15 | `swimming`, `dancing`, `climbing`, `falling` sin definir |
| Stylistic | 13 | `watercolor`, `oil_painting`, `flat_color`; `cel_shading` solo en blocks |

### Debilidades detectadas del sistema actual

1. **Sistema unidireccional**: Si `nude` bloquea `clothed`, `clothed` bloquea `nude`, pero no hay garantía de simetría para todos los triggers
2. **Excepciones limitadas**: Solo `looking_back`, `looking_over_shoulder`, `profile` para `from_behind`; faltan casos como `mirror` reflection
3. **Sin cobertura de tags compuestos**: `1girl, 2boys` → ¿debe ser multi-char? Actualmente solo se detecta si un tag individual matchea
4. **`isRelatedTag` muy básico**: Solo cubre sufijos para `eyes`, `hair`, `breasts`. No cubre `skin`, `legs`, `arms`, `clothes`, `shoes`, etc.
5. **Sin validación empírica**: El stress test actual solo prueba 50 posts con 8 tags añadidos fijos
6. **Sin cobertura de tags numéricos**: `6+girls` en blocks de `1girl` pero no hay `7+girls`, `8+girls`, etc.

---

## Plan: Agente de Análisis Exhaustivo

### Fase 1 — Script de Análisis de Gaps (`scripts/analyze-tag-conflicts.ts`)

Crear un script autónomo que:

#### 1.1 Coverage Analyzer
- Para cada trigger en `TAG_CONFLICTS`, verificar que TODOS los tags semánticamente relacionados estén en `blocks`
- Usar un mapeo de familias de tags (ej: `shoes` → incluye `sneakers`, `boots`, `heels`, `loafers`, `sandals`, `slippers`, `flats`, `platforms`, etc.)
- Reportar tags huérfanos (tags en blocks de un trigger pero no cubiertos)

#### 1.2 Symmetry Checker
- Para cada par `(trigger, blockTarget)`, verificar si existe la regla inversa
- Si `nude` bloquea `clothed`, ¿`clothed` bloquea `nude`?
- Reportar asimetrías

#### 1.3 Transitive Closure Checker
- Si A bloquea B y B bloquea C, verificar si A debería bloquear C
- Ej: `nude` bloquea `dress`, `dress` bloquea `pants` → ¿`nude` debería bloquear `pants`? (sí)

#### 1.4 Missing Trigger Detector
- Identificar categorías de tags comunes de Danbooru que NO aparecen como triggers
- Categorías candidatas: `weapon`, `food`, `season`, `time_of_day`, `age`, `species`, `art_style`, `medium`
- Cross-reference con top 500 tags de Danbooru

#### 1.5 Exception Completeness Checker
- Para cada trigger con `exceptions`, verificar si las excepciones cubren todos los casos válidos
- Ej: `from_behind` exceptions → ¿falta `mirror`, `reflection`, `selfie`?

#### 1.6 False Positive Simulator
- Generar combinaciones de tags base + tags añadidos
- Feed them through `resolveTagConflicts`
- Identificar combinaciones donde el bloqueo es incorrecto (falso positivo)

#### 1.7 Redundancy Detector  
- Identificar triggers duplicados o redundantes
- `nude` vs `naked` → casi idénticos, ¿se pueden mergear?

### Fase 2 — Expansión del Stress Test (`__tests__/stress-test-danbooru.ts`)

#### 2.1 Muestreo expansivo
- Aumentar de 50 → 500+ posts
- Buscar posts de MÚLTIPLES páginas aleatorias
- Incluir filtros por tag count variado (10+, 30+, 50+)

#### 2.2 Tags de prueba variados
- En lugar de 8 tags fijos, usar un pool de 50+ tags comunes
- Rotar aleatoriamente qué tags se "añaden" a cada post
- Cubrir todas las categorías del diccionario

#### 2.3 Métricas de cobertura
- % de triggers del diccionario que se activaron en posts reales
- % de tags en blocks que se probaron contra datos reales
- % de excepciones que se validaron

### Fase 3 — Refuerzo del Motor (`lib/tag-conflicts.ts`)

#### 3.1 Expandir `isRelatedTag`
```typescript
// Actual: solo eyes, hair, breasts
// Propuesto: 
- skin → dark_skin, pale_skin, fair_skin, tanned_skin...
- legs → bare_legs, crossed_legs, legs_apart...
- arms → bare_arms, crossed_arms, arms_up...
- clothes → winter_clothes, school_uniform, casual_clothes...
- shoes → high_heels, sneakers, boots, sandals...
- ears → cat_ears, dog_ears, elf_ears, animal_ears...
- tail → cat_tail, dog_tail, fox_tail...
- background → white_background, simple_background, detailed_background...
```

#### 3.2 Agregar nuevos triggers basados en gaps

| Trigger | Blocks | Justificación |
|---------|--------|---------------|
| `bald` | `long_hair`, `short_hair`, `ponytail`, etc. | Faltante obvio |
| `armor` | `nude`, `naked`, `topless`, `swimsuit`, `bare_skin` | Armor cubre el cuerpo |
| `swimming` | `winter_clothes`, `armor`, `heavy_coat` | Incompatible |
| `dancing` | `sleeping`, `lying_down`, `sitting` | Acción vs reposo |
| `surprised` | `calm`, `peaceful`, `sleeping`, `bored` | Emociones opuestas |
| `space` | `sky`, `cloud`, `sun`, `beach`, `forest` | Setting incompatible |
| `mirror` | Nuevas excepciones para `from_behind`, `profile` | Reflection muestra lo que la pose oculta |
| `upside-down` | `standing`, `walking`, `running` | Gravedad |
| `wet` (expandido) | Agregar `clothes` variants a los blocks | `wet_clothes` ya no son `dry` |
| `blood` | `clean`, `pristine`, `immaculate`, `peaceful` | Gore vs pacífico |

#### 3.3 Agregar excepciones faltantes

| Trigger | Excepción | Desbloquea |
|---------|-----------|------------|
| `from_behind` | `mirror_reflection` | Todos los tags faciales + frontal anatomy |
| `from_behind` | `selfie` | `face`, `eyes`, `smile` |
| `nude`/`naked` | `towel` | `towel` (única "ropa" permitida) |
| `sleeping` | `sleepwalking` | `standing`, `walking` (ya existe) |
| `closed_eyes` | `one_eye_closed` | Ya existe, verificar |

#### 3.4 Simetría bidireccional
- Convertir reglas unidireccionales en bidireccionales donde aplique
- Si `standing` bloquea `sitting`, verificar que `sitting` bloquee `standing`

### Fase 4 — Tests Automatizados

#### 4.1 Property-based tests
- Generar tags aleatorios de un pool de 500+
- Verificar que `resolveTagConflicts` nunca crashea
- Verificar que los resultados son deterministas

#### 4.2 Snapshot tests
- Golden set de 100 combinaciones con resultados esperados
- Correr en CI para detectar regresiones

#### 4.3 Coverage target
- 95% de líneas cubiertas en `tag-conflicts.ts`

---

## Archivos Involucrados

| Archivo | Acción |
|---------|--------|
| `scripts/analyze-tag-conflicts.ts` | **CREAR** — Script análisis exhaustivo |
| `scripts/tag-families.json` | **CREAR** — Mapeo de familias semánticas de tags |
| `lib/tag-conflicts.ts` | **MODIFICAR** — Expandir triggers, exceptions, isRelatedTag |
| `__tests__/stress-test-danbooru.ts` | **MODIFICAR** — 500+ posts, tags variados |
| `__tests__/tag-conflicts.spec.ts` | **MODIFICAR** — Agregar property-based + snapshot tests |
| `__tests__/run-tests.cjs` | **MODIFICAR** — Agregar nuevos tests al runner |

---

## Deliverables

1. **`scripts/analyze-tag-conflicts.ts`** — El agente de análisis que:
   - Corre todos los checkers de la Fase 1
   - Genera un reporte markdown con gaps encontrados
   - Sugiere nuevas reglas en formato copiable al diccionario
   - Estima el coverage actual del diccionario

2. **`scripts/tag-families.json`** — Mapeo de ~50 familias semánticas con 500+ tags de Danbooru

3. **Nuevas reglas en `TAG_CONFLICTS`** — 20-40 nuevos triggers con sus blocks y excepciones

4. **Stress test expandido** — 500 posts, 50+ tags de prueba, métricas de cobertura

5. **Tests automatizados** — Property-based + snapshots

---

## Riesgos y Tradeoffs

- **Riesgo**: Expandir demasiado el diccionario puede hacer `resolveTagConflicts` lento (O(n²) actual)
  - *Mitigación*: Medir performance actual vs post-expansión. Si >20ms por llamada, optimizar con Set precomputados
  
- **Riesgo**: Reglas muy agresivas bloquean tags que el usuario SÍ quiere
  - *Mitigación*: El toggle on/off ya existe, y los tags bloqueados se muestran visualmente

- **Tradeoff**: Simetría vs flexibilidad — no todas las reglas deben ser simétricas
  - Ej: `1girl` bloquea `2girls`, pero `2girls` no necesariamente bloquea `1girl`

- **Riesgo**: Tags de Danbooru evolucionan con el tiempo, reglas pueden quedar obsoletas
  - *Mitigación*: El script de análisis puede re-correr periódicamente

---

## Preguntas Abiertas

1. ¿Incluir tags específicos de ciertos providers (e621, Gelbooru) o solo Danbooru?
2. ¿Priorizar cantidad de triggers o precisión de los existentes?
3. ¿El agente debe correr como cron job periódico o es one-shot?
