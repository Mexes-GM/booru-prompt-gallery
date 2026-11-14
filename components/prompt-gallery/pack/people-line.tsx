"use client"

/**
 * Who else is in the picture. Shown when the pose needs more than one person (then it
 * says so: "This pose needs 2 people"), when the user set the people, or when the scenes
 * come in more than one make-up; each option says how many scenes it has.
 *
 * With `onToggle` the options are marked one by one: the pack mixes every make-up marked
 * (one at least). Make-ups with no room for the characters are shown, not offered, and
 * say why. Without it (a one-part pack, where the scene that repeats sets the people) it
 * is a single choice.
 */
import { memo, useId, useMemo } from "react"
import { Check, Users } from "lucide-react"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { cn } from "@/lib/utils"
import { ChoiceGroup, type Choice } from "./choice-group"
import { SLOT_ROW, SlotLabel } from "./brief-slot"
import { companionsLabel } from "./slots"
import { PEOPLE_TEXT, peopleKey, poseNeedsText } from "./pack-text"

export interface PeopleOption {
  people: PackPeople
  scenes: number
}

export interface PeopleLineProps {
  options: readonly PeopleOption[]
  /** The chosen make-up; null while the scenes decide. */
  value: PackPeople | null
  onChange: (people: PackPeople) => void
  /** The people on the card itself, so the options read as who else is there. */
  cast: PackPeople
  /** How many people the requested pose needs, when it needs company (2 for a princess carry). */
  poseNeeds?: number
  /** A new value lights the line up once (a count typed in another row landed here). */
  flashKey?: number
  /** Several make-ups: the ones the pack uses, and the toggle of one. */
  selected?: readonly PackPeople[]
  onToggle?: (people: PackPeople) => void
  /** Make-ups with no room for the characters: shown, not offered. */
  blocked?: readonly PeopleOption[]
  /** Said under the line (a one-part pack: the scene that repeats sets the people). */
  note?: string
}

const samePeople = (a: PackPeople, b: PackPeople) => a.girls === b.girls && a.boys === b.boys

export const PeopleLine = memo(function PeopleLine({
  options,
  value,
  onChange,
  cast,
  poseNeeds,
  flashKey,
  selected,
  onToggle,
  blocked = [],
  note,
}: PeopleLineProps) {
  const labelId = useId()
  const reasonId = useId()
  const choices = useMemo<Choice<string>[]>(
    () =>
      options.map((o) => ({
        value: peopleKey(o.people),
        label: companionsLabel(o.people, cast),
        count: o.scenes,
        disabled: o.scenes === 0,
      })),
    [options, cast],
  )
  const needsCompany = poseNeeds !== undefined && poseNeeds >= 2
  if (!needsCompany && options.length < 2) return null
  const reason = needsCompany ? poseNeedsText(poseNeeds) : null
  const described = [reason, note].filter(Boolean).length > 0 ? reasonId : undefined

  const byKey = (key: string) => options.find((o) => peopleKey(o.people) === key)?.people
  return (
    <div className={`${SLOT_ROW} relative py-1`}>
      {flashKey ? (
        <span
          key={flashKey}
          aria-hidden
          className="pointer-events-none absolute -inset-x-1.5 inset-y-0 rounded-md bg-mode-pack-soft animate-out fade-out-0 fill-mode-forwards duration-1000 ease-out-strong motion-reduce:hidden"
        />
      ) : null}
      <SlotLabel id={labelId} label="People" icon={<Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />} />
      <div className="min-w-0 space-y-1">
        {onToggle && selected ? (
          <div role="group" aria-labelledby={labelId} aria-describedby={described} className="flex flex-wrap items-center gap-1.5">
            {options.map((o) => {
              const on = selected.some((p) => samePeople(p, o.people))
              const last = on && selected.length === 1
              return (
                <ToggleOption
                  key={peopleKey(o.people)}
                  label={companionsLabel(o.people, cast)}
                  scenes={o.scenes}
                  on={on}
                  // The last make-up marked stays: a pack has people.
                  disabled={last || (!on && o.scenes === 0)}
                  title={last ? PEOPLE_TEXT.lastOne : undefined}
                  onClick={() => onToggle(o.people)}
                />
              )
            })}
            {blocked.map((o) => (
              <ToggleOption
                key={`blocked:${peopleKey(o.people)}`}
                label={companionsLabel(o.people, cast)}
                scenes={o.scenes}
                on={false}
                disabled
                title={PEOPLE_TEXT.noRoom}
                reason={PEOPLE_TEXT.noRoom}
              />
            ))}
          </div>
        ) : (
          <ChoiceGroup
            variant="pills"
            size="sm"
            choices={choices}
            value={value ? peopleKey(value) : null}
            onChange={(key) => {
              const people = byKey(key)
              if (people) onChange(people)
            }}
            labelledBy={labelId}
            describedBy={described}
          />
        )}
        {(reason || note) && (
          <p id={reasonId} className="text-xs text-muted-foreground">
            {[reason, note].filter(Boolean).join(". ")}
          </p>
        )}
      </div>
    </div>
  )
})

function ToggleOption({
  label,
  scenes,
  on,
  disabled,
  title,
  reason,
  onClick,
}: {
  label: string
  scenes: number
  on: boolean
  disabled?: boolean
  title?: string
  reason?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium pointer-coarse:h-11 pointer-coarse:min-w-11",
        "transition-[color,background-color,border-color] duration-150 ease-out-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed",
        on
          ? "border-mode-pack-border bg-mode-pack-soft text-mode-pack-text"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("grid size-3.5 place-items-center rounded-[4px] border", on ? "border-mode-pack-text" : "border-muted-foreground/60")}
      >
        {on && <Check className="size-2.5" />}
      </span>
      <span>{label}</span>
      <span className={cn("tabular-nums", on ? "text-mode-pack-text" : "text-muted-foreground")}>
        <span aria-hidden>· </span>
        {scenes}
        <span className="sr-only">{scenes === 1 ? " scene" : " scenes"}</span>
      </span>
      {reason && <span className="sr-only">, {reason}</span>}
    </button>
  )
}
