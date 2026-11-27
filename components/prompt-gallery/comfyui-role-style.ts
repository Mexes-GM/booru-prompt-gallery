import type { RoleKey } from "@/lib/comfyui/role-choices"

/**
 * One color per role, shared by the panel's summary and the workflow viewer.
 * Each role also carries its name in text, so color is never the only cue.
 */
export const ROLE_STYLE: Record<RoleKey, { label: string; swatch: string; chip: string; row: string; hint: string }> = {
  prompt: {
    label: "Prompt",
    swatch: "bg-tag-general",
    chip: "bg-tag-general text-tag-general-foreground",
    row: "bg-tag-general-soft border-tag-general-border text-foreground",
    hint: "border-dashed border-tag-general-border",
  },
  seed: {
    label: "Seed",
    swatch: "bg-warning",
    chip: "bg-warning text-warning-foreground",
    row: "bg-warning-soft border-warning-border text-foreground",
    hint: "border-dashed border-warning-border",
  },
  size: {
    label: "Size",
    swatch: "bg-tag-character",
    chip: "bg-tag-character text-tag-character-foreground",
    row: "bg-tag-character-soft border-tag-character-border text-foreground",
    hint: "border-dashed border-tag-character-border",
  },
  output: {
    label: "Output",
    swatch: "bg-tag-copyright",
    chip: "bg-tag-copyright text-tag-copyright-foreground",
    row: "bg-tag-copyright-soft border-tag-copyright-border text-foreground",
    hint: "border-dashed border-tag-copyright-border",
  },
}
