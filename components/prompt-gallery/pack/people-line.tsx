"use client"

/**
 * Who else is in the picture. Shown only when the pose needs more than one person
 * (then it says so: "This pose needs 2 people") or the scenes come in more than one
 * make-up; each option says how many scenes it has.
 */
import { memo, useId, useMemo } from "react"
import { Users } from "lucide-react"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { ChoiceGroup, type Choice } from "./choice-group"
import { SLOT_ROW, SlotLabel } from "./brief-slot"
import { companionsLabel } from "./slots"
import { peopleKey, poseNeedsText } from "./pack-text"

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
}

export const PeopleLine = memo(function PeopleLine({ options, value, onChange, cast, poseNeeds }: PeopleLineProps) {
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

  const byKey = (key: string) => options.find((o) => peopleKey(o.people) === key)?.people
  return (
    <div className={`${SLOT_ROW} py-1`}>
      <SlotLabel id={labelId} label="People" icon={<Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />} />
      <div className="min-w-0 space-y-1">
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
          describedBy={reason ? reasonId : undefined}
        />
        {reason && (
          <p id={reasonId} className="text-xs text-muted-foreground">
            {reason}
          </p>
        )}
      </div>
    </div>
  )
})
