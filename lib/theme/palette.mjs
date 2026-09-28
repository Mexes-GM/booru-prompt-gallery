// Fuente única de verdad del color de la app.
//
// Editar aquí y ejecutar `npm run theme:build`. El generador (scripts/build-theme.mjs)
// reescribe el bloque @theme-tokens de app/globals.css, lib/theme/tokens.generated.ts y las variables
// de extension/sidepanel.html, y valida contraste WCAG y gamut sRGB.
// Todos los valores son OKLCH: [L (0–1), C (croma), H (tono en grados)].

/**
 * Superficies, texto y marca. Valores fijos (convertidos 1:1 desde el HSL que
 * había antes para no cambiar el aspecto actual). El generador añade
 * --primary-text: el violeta de marca ajustado para texto legible sobre superficies.
 */
export const neutrals = {
  light: {
    background: [0.95, 0.012, 250],
    foreground: [0.22, 0.025, 253],
    card: [0.97, 0.014, 250],
    "card-foreground": [0.22, 0.025, 253],
    popover: [0.97, 0.014, 250],
    "popover-foreground": [0.22, 0.025, 253],
    primary: [0.34, 0.075, 150],
    "primary-foreground": [1, 0, 0],
    secondary: [0.9, 0.014, 250],
    "secondary-foreground": [0.24, 0.02, 253],
    muted: [0.885, 0.016, 250],
    "muted-foreground": [0.46, 0.022, 252],
    accent: [0.885, 0.016, 250],
    "accent-foreground": [0.24, 0.02, 253],
    border: [0.83, 0.02, 248],
    input: [0.83, 0.02, 248],
    ring: [0.34, 0.075, 150],
  },
  dark: {
    background: [0.27, 0.022, 250],
    foreground: [0.94, 0.014, 248],
    card: [0.305, 0.024, 250],
    "card-foreground": [0.94, 0.014, 248],
    popover: [0.305, 0.024, 250],
    "popover-foreground": [0.94, 0.014, 248],
    primary: [0.64, 0.11, 150],
    "primary-foreground": [0.2, 0.02, 250],
    secondary: [0.35, 0.022, 250],
    "secondary-foreground": [0.94, 0.014, 248],
    muted: [0.37, 0.022, 250],
    "muted-foreground": [0.78, 0.02, 250],
    accent: [0.37, 0.022, 250],
    "accent-foreground": [0.94, 0.014, 248],
    border: [0.4, 0.024, 250],
    input: [0.4, 0.024, 250],
    ring: [0.58, 0.09, 150],
  },
}

/**
 * Rampas compartidas por todos los roles de color. Cada rol solo aporta su tono;
 * la luminosidad y el croma salen de aquí, así todos pesan lo mismo visualmente.
 *   solid → rellenos (puntos, badges y botones sólidos)
 *   text  → texto e iconos sobre superficies neutras (se oscurece/aclara hasta
 *           cumplir `minContrast` contra background y card)
 * El croma se reduce automáticamente si el color se sale del gamut sRGB.
 */
export const ramps = {
  light: { solid: { l: 0.63, c: 0.125 }, text: { l: 0.44, c: 0.135 }, minContrast: 4.5 },
  dark: { solid: { l: 0.72, c: 0.135 }, text: { l: 0.8, c: 0.125 }, minContrast: 4.5 },
}

/** Porcentaje del color de rol mezclado con transparente para fondos y bordes tintados. */
export const mix = {
  light: { soft: 10, border: 30 },
  dark: { soft: 16, border: 40 },
}

/**
 * Roles de color. Cada uno genera: --X (sólido), --X-foreground (texto sobre el
 * sólido), --X-text (texto/icono sobre superficies) y, en Tailwind, X-soft / X-border.
 * `solid` permite fijar el sólido a mano por tema en lugar de derivarlo de la rampa.
 * `solidL` cambia solo su luminosidad: los ámbar/amarillos se vuelven marrones a
 * luminosidad media, así que usan un sólido claro (el generador les pone texto oscuro).
 */
const AMBER_SOLID_L = { light: 0.78, dark: 0.78 }

// Rueda de tono: los 5 tag-* son fijos (convención Danbooru); los otros 17 roles
// se reparten en los huecos. La banda 258°-322° (índigo/violeta/magenta, el
// territorio del "AI slop") queda en cuarentena: solo copyright vive ahí,
// porque ese magenta es el color real de Danbooru, no una elección estética.
// Ningún otro rol puede tener un tono ahí dentro.
// Orden alrededor del círculo: favorites(5) reverse(15) artist(25) destructive(35)
// appearance(45) meta(60) warning(81, ámbar) convert(102, ámbar) scenery(123)
// character(145) primary(150, en neutrals) success(162) clothing(174)
// equipment(186) creature(198) pose(210) merge(222) pack(234) info(246) general(255)
// — cuarentena 258°-322° (índigo/violeta/magenta) — copyright(325) teach(355)
//
// El verde-amarillo/verde-cian (~100-210°) es la banda donde el ojo discrimina
// peor el matiz (elipses de MacAdam más anchas ahí que en azules/rojos), así que
// scenery/clothing/equipment/creature/pose NO pueden ser vecinos directos aunque
// numéricamente parezcan bien separados: equipment se intercala entre clothing y
// creature, y scenery vive sola, lejos de pose, para que Pack Builder (los 6 ejes
// de categoría uno junto a otro) no los confunda.
export const roles = {
  // Estados del sistema
  destructive: { group: "status", label: "Error / destructivo", hue: 35 },
  success: { group: "status", label: "Éxito", hue: 164 },
  warning: { group: "status", label: "Aviso", hue: 81, solidL: AMBER_SOLID_L },
  info: { group: "status", label: "Información", hue: 246 },

  // Tipos de tag de Danbooru (convención del propio Danbooru, fijos)
  "tag-general": { group: "tag", label: "General", hue: 255 },
  "tag-artist": { group: "tag", label: "Artist", hue: 25 },
  "tag-copyright": { group: "tag", label: "Copyright", hue: 325 },
  "tag-character": { group: "tag", label: "Character", hue: 145 },
  "tag-meta": { group: "tag", label: "Meta", hue: 60 },

  // Categorías de prompt (la categoría "other" usa los neutros muted). Orden a
  // propósito para que ningún par de vecinos caiga en la banda verde-amarilla/
  // verde-cian de mal discernimiento: clothing → equipment → creature → pose,
  // con scenery aislada en la zona ámbar, lejos de pose.
  "cat-appearance": { group: "category", label: "Appearance", hue: 45 },
  "cat-scenery": { group: "category", label: "Scenery", hue: 123 },
  "cat-clothing": { group: "category", label: "Clothing", hue: 178 },
  "cat-equipment": { group: "category", label: "Equipment", hue: 192 },
  "cat-creature": { group: "category", label: "Creature", hue: 206 },
  "cat-pose": { group: "category", label: "Pose", hue: 220 },

  // Identidad de modos. Uso restringido a acentos: icono, texto del botón activo,
  // fondo suave cuando el modo está activo. Nunca rellenos grandes.
  "mode-favorites": { group: "mode", label: "Favoritos", hue: 5 },
  "mode-merge": { group: "mode", label: "Merge", hue: 229 },
  "mode-pack": { group: "mode", label: "Pack", hue: 238 },
  "mode-reverse": { group: "mode", label: "Reverse parser", hue: 15 },
  "mode-teach": { group: "mode", label: "Teach", hue: 355 },
  "mode-convert": { group: "mode", label: "AI Convert", hue: 102, solidL: AMBER_SOLID_L },
}

/** Capa sobre imágenes (badges y scrims). Igual en ambos temas. */
export const overlay = {
  overlay: [0.18, 0.02, 265],
  "overlay-foreground": [1, 0, 0],
}
