import { useEffect, useRef, useState } from "react"

/**
 * Loads the `/detailed-backgrounds.json` scenery dataset used by the
 * "Detailed Random" background mode. Shared by the main gallery and the
 * extension client so the fetch/validation logic lives in exactly one place.
 *
 * The dataset is fetched lazily (only when `enabled` is true, i.e. the user
 * actually selects Detailed Random) and only once per mount. A previous bug
 * gated this fetch on the `random` mode instead of `detailed_random`, which
 * meant Detailed Random silently behaved like "Remove All" because the list
 * stayed empty. Gating on the real consumer fixes that and also avoids the
 * wasted download that Simple Random used to trigger.
 */
export function useDetailedBackgrounds(enabled: boolean): string[][] {
  const [list, setList] = useState<string[][]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled || loadedRef.current) return
    loadedRef.current = true

    const controller = new AbortController()
    fetch("/detailed-backgrounds.json", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Invalid detailed-backgrounds.json format")
        setList(
          data.map((item: any) =>
            item?.scenery && Array.isArray(item.scenery) ? (item.scenery as string[]) : []
          )
        )
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          loadedRef.current = false // allow retry after a failure
          console.error("Failed to load detailed backgrounds:", err)
        }
      })

    return () => controller.abort()
  }, [enabled])

  return list
}
