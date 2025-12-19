# Plan de Actualización y Mantenimiento

## 1. Actualización de Versiones
- [x] **Node.js**: Actualizado `engines` en `package.json` a `>=24.12.0`.
- [x] **Dependencias**: Actualizadas todas las dependencias principales a sus versiones estables más recientes.
    - `next`: v15.5.9 (Se intentó v16 pero causó errores críticos con Turbopack, se optó por la última v15 estable).
    - `react`: v19.2.3
    - `tailwindcss`: v3.4.17 (Se intentó v4 pero se revirtió por incompatibilidad con la configuración actual).
    - `lucide-react`, `zod`, `react-hook-form`, etc. actualizados.

## 2. Correcciones de Código
- [x] **ESLint**: Se corrigieron múltiples errores de linter que impedían la compilación.
    - Reglas de Hooks de React (`react-hooks/rules-of-hooks`).
    - Caracteres no escapados en JSX.
    - Reemplazo de etiquetas `<a>` por componentes `<Link>` de Next.js.
    - Ajuste de configuración `.eslintrc.json` para permitir `any` explícito en casos necesarios.
- [x] **Tailwind & CSS**:
    - Se restauró la configuración compatible con Tailwind v3.
    - Se corrigieron directivas `@apply` en `globals.css` para evitar errores de construcción.

## 3. Verificación
- [x] **Build**: `npm run build` ejecutado exitosamente.
- [x] **Tests**: Pruebas unitarias (`__tests__/run-tests.cjs`) ejecutadas y aprobadas.

## 4. Estado Final
El proyecto está actualizado, compila correctamente y pasa las pruebas. Se han documentado los cambios y las versiones instaladas.
