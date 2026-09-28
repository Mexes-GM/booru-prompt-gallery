import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { colorCollisions, colorRoles, neutralContrast, themeHex } from "@/lib/theme/tokens.generated"

export const metadata: Metadata = {
  title: "Tokens de color",
  robots: { index: false, follow: false },
}

// Catálogo visual de los tokens de lib/theme/palette.mjs. Solo en desarrollo.
// Usa estilos inline con var(--token) porque los nombres de rol son dinámicos
// y Tailwind no generaría clases construidas en tiempo de ejecución.

type Theme = "light" | "dark"
type Role = (typeof colorRoles)[number]

const GROUPS: { id: Role["group"]; title: string; note: string }[] = [
  { id: "status", title: "Estados", note: "Mensajes, validaciones, salud del sistema." },
  { id: "tag", title: "Tipos de tag (Danbooru)", note: "Solo en el autocompletado; siempre acompañados de su etiqueta." },
  { id: "category", title: "Categorías de prompt", note: "Chips, filtros y contenedores por categoría. «Other» usa muted." },
  { id: "mode", title: "Modos", note: "Solo acentos: icono, texto activo y fondo suave. Nunca rellenos grandes." },
]

const NEUTRALS = [
  "background", "card", "popover", "secondary", "muted", "accent",
  "foreground", "muted-foreground", "border", "primary", "primary-text", "ring",
] as const

const soft = (name: string) => `color-mix(in oklab, var(--${name}) var(--mix-soft), transparent)`
const line = (name: string) => `color-mix(in oklab, var(--${name}) var(--mix-border), transparent)`

function Ratio({ value }: { value: number }) {
  const ok = value >= 4.5
  return (
    <span className={`tabular-nums ${ok ? "text-muted-foreground" : "font-semibold text-destructive-text"}`}>
      {value.toFixed(2)}
    </span>
  )
}

function RoleRow({ role, theme }: { role: Role; theme: Theme }) {
  const data = role[theme]
  const hex = themeHex[theme] as Record<string, string>
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border py-2.5 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: `var(--${role.name})` }} />
        <span
          className="rounded-md border px-2 py-0.5 text-xs font-medium"
          style={{ background: soft(role.name), borderColor: line(role.name), color: `var(--${role.name}-text)` }}
        >
          {role.label}
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-xs font-semibold"
          style={{ background: `var(--${role.name})`, color: `var(--${role.name}-foreground)` }}
        >
          Sólido
        </span>
        <span className="text-sm font-medium" style={{ color: `var(--${role.name}-text)` }}>
          Texto de ejemplo
        </span>
      </div>
      <div className="text-right font-mono text-[10px] leading-tight text-muted-foreground">
        <div>--{role.name} · h{role.hue}</div>
        <div>
          {hex[role.name]} / {hex[`${role.name}-text`]}
        </div>
        <div>
          texto <Ratio value={data.textOnBackground} /> · sólido <Ratio value={data.foregroundOnSolid} />
        </div>
      </div>
    </div>
  )
}

function ThemePanel({ theme }: { theme: Theme }) {
  const hex = themeHex[theme] as Record<string, string>
  return (
    <section className={`${theme} min-w-0 rounded-xl border border-border bg-background p-4 text-foreground sm:p-6`}>
      <h2 className="mb-4 text-lg font-bold">{theme === "light" ? "Claro" : "Oscuro"}</h2>

      <h3 className="mb-2 text-sm font-semibold">Superficies, texto y marca</h3>
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {NEUTRALS.map((name) => (
          <div key={name} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="h-10" style={{ background: `var(--${name})` }} />
            <div className="px-2 py-1 font-mono text-[10px] leading-tight">
              <div className="truncate">{name}</div>
              <div className="text-muted-foreground">{hex[name]}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Botón primario</span>
        <span className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">Secundario</span>
        <span className="rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground">Destructivo</span>
        <span className="text-sm font-medium text-primary-text">Enlace violeta</span>
        <span className="rounded-md bg-overlay/60 px-2 py-0.5 text-xs text-overlay-foreground">Overlay</span>
      </div>

      <div className="mb-6 rounded-lg border border-border bg-card p-3 text-xs">
        <div className="mb-1 font-semibold">Contraste de neutros (mínimo AA 4.5)</div>
        <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {neutralContrast[theme].map(({ fg, bg, ratio }) => (
            <li key={`${fg}-${bg}`} className="flex justify-between gap-2 font-mono text-[10px]">
              <span className="truncate text-muted-foreground">
                {fg} / {bg}
              </span>
              <Ratio value={ratio} />
            </li>
          ))}
        </ul>
      </div>

      {GROUPS.map((group) => (
        <div key={group.id} className="mb-6">
          <h3 className="text-sm font-semibold">{group.title}</h3>
          <p className="mb-2 text-xs text-muted-foreground">{group.note}</p>
          <div className="rounded-lg border border-border bg-card px-3">
            {colorRoles
              .filter((r) => r.group === group.id)
              .map((role) => (
                <RoleRow key={role.name} role={role} theme={theme} />
              ))}
          </div>
        </div>
      ))}

      <h3 className="mb-2 text-sm font-semibold">Colisiones (ΔE &lt; 0.06)</h3>
      <ul className="space-y-1 text-xs">
        {colorCollisions[theme].map(({ a, b, deltaE }) => (
          <li key={`${a}-${b}`} className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: `var(--${a})` }} />
            <span className="size-3 rounded-full" style={{ background: `var(--${b})` }} />
            <span className="font-mono">
              {a} ~ {b}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">{(deltaE as number) === 0 ? "mismo tono" : deltaE}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function ColorTokensPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Tokens de color</h1>
      <p className="mb-6 mt-1 max-w-3xl text-sm text-muted-foreground">
        Generados desde <code className="font-mono">lib/theme/palette.mjs</code> con{" "}
        <code className="font-mono">npm run theme:build</code>. Cada rol expone{" "}
        <code className="font-mono">bg-X</code> (sólido), <code className="font-mono">text-X-foreground</code>,{" "}
        <code className="font-mono">text-X-text</code>, <code className="font-mono">bg-X-soft</code> y{" "}
        <code className="font-mono">border-X-border</code>.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
    </main>
  )
}
