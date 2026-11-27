/**
 * Pace for the requests Pack Mode sends to a site: one token bucket per site, shared by
 * every Pack request (the first page of each search, the later pages, the page counts and
 * the cast's own solo posts).
 *
 * Danbooru allows 10 requests a second per IP and asks for about one a second over a long
 * session; the Worker that serves the other sites allows 60 a minute per IP. So a site
 * gets PACE.burst requests at once (the first page of several searches together, well
 * under 10 a second), and past them one every 1000 / PACE.perSecond ms.
 *
 * Pure apart from timers: the clock is injectable, so tests run it without waiting.
 */
import type { BooruProvider } from "./types"

export const PACE = {
  /** Requests that may go at once. */
  burst: 4,
  /** Requests a second past the burst. */
  perSecond: 1,
} as const

export interface PacerClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const realClock: PacerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export class RequestPacer {
  private tokens: number
  private last: number
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly burst: number = PACE.burst,
    private readonly perSecond: number = PACE.perSecond,
    private readonly clock: PacerClock = realClock,
  ) {
    this.tokens = burst
    this.last = clock.now()
  }

  private refill(): void {
    const now = this.clock.now()
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond)
    this.last = now
  }

  /** How long until `n` requests may go (0: now). `n` above the burst waits as for the burst. */
  msUntil(n = 1): number {
    this.refill()
    const need = Math.min(n, this.burst)
    return this.tokens >= need ? 0 : Math.ceil(((need - this.tokens) / this.perSecond) * 1000)
  }

  /** Spends `n` requests now (the caller checked msUntil). */
  take(n = 1): void {
    this.refill()
    this.tokens -= n
  }

  /**
   * Resolves when one request may go, and spends it. Waiters go in the order they asked.
   * A waiter whose signal is aborted before its turn spends nothing and rejects.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
        const wait = this.msUntil(1)
        if (wait <= 0) break
        await this.clock.sleep(wait)
      }
      this.take(1)
    })
    this.queue = turn.catch(() => {})
    return turn
  }
}

const pacers = new Map<BooruProvider, RequestPacer>()

/** The one pacer of a site, for the app's life. */
export function sitePacer(provider: BooruProvider): RequestPacer {
  let pacer = pacers.get(provider)
  if (!pacer) {
    pacer = new RequestPacer()
    pacers.set(provider, pacer)
  }
  return pacer
}
