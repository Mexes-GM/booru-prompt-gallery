/**
 * API route instrumentation — RED (Rate, Errors, Duration) wrapper.
 *
 * Wraps a Next.js Route Handler to automatically:
 *  1. Extract/attach a request ID (from x-request-id header or generated).
 *  2. Log structured request start/end events with duration.
 *  3. Track errors with full context.
 *
 * On-call questions this answers:
 *   Q3: "Which endpoints are slow?" → Filter event=request, inspect durationMs.
 *   Q3: "Which endpoints are erroring?" → Filter event=request, status>=500.
 *   Q1: "What happened during request X?" → Filter by requestId.
 *
 * Usage (Edge runtime — lightweight, no process metrics):
 *
 *   import { instrumented } from "@/lib/instrumentation"
 *
 *   export const GET = instrumented(async (req) => {
 *     // ... handler code
 *   })
 *
 * For Node.js runtime, use `instrumentedNode` which also tracks
 * memory/heap via process.memoryUsage() (disabled in Edge).
 */

import { NextRequest, NextResponse } from "next/server"
import { Logger, generateRequestId } from "./logger"

export type RouteHandler = (
  request: NextRequest,
  context?: { params: Record<string, string | Promise<string>> }
) => Promise<NextResponse | Response>

/**
 * Wrap a route handler with automatic RED logging.
 * Works in both Edge and Node.js runtimes.
 */
export function instrumented(
  handler: RouteHandler,
  routeName?: string
): RouteHandler {
  return async (request, context) => {
    const startMs = Date.now()

    // Extract or generate request ID
    const requestId =
      request.headers.get("x-request-id") ?? generateRequestId()

    // Infer route name from URL if not provided
    const pathname = request.nextUrl?.pathname ?? ""
    const route = routeName ?? pathname

    const log = new Logger({
      route,
      requestId,
      method: request.method,
    })

    log.debug("request_start", {
      search: request.nextUrl?.search.slice(0, 200),
    })

    try {
      const response = await handler(request, context)
      const durationMs = Date.now() - startMs

      // Normalize to NextResponse for header patching
      const nextRes =
        response instanceof NextResponse
          ? response
          : NextResponse.next()

      // Attach request ID to response
      nextRes.headers.set("x-request-id", requestId)

      // Structured RED log
      const statusClass =
        Math.floor(nextRes.status / 100) + "xx"
      if (nextRes.status >= 500) {
        log.error("request", {
          durationMs: Math.round(durationMs),
          status: nextRes.status,
          statusClass,
        })
      } else if (nextRes.status >= 400) {
        log.warn("request", {
          durationMs: Math.round(durationMs),
          status: nextRes.status,
          statusClass,
        })
      } else {
        log.info("request", {
          durationMs: Math.round(durationMs),
          status: nextRes.status,
          statusClass,
        })
      }

      if (response instanceof NextResponse) {
        return nextRes
      }
      // Merge original response headers (Content-Type, Cache-Control, etc.)
      // into the NextResponse-based headers that carry x-request-id.
      const merged = new Headers()
      response.headers.forEach((v, k) => merged.set(k, v))
      nextRes.headers.forEach((v, k) => merged.set(k, v))
      return new Response(response.body, {
        status: response.status,
        headers: merged,
      })
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs
      const message =
        error instanceof Error ? error.message : String(error)

      log.error("request_error", {
        durationMs: Math.round(durationMs),
        error: message.slice(0, 300),
      })

      return NextResponse.json(
        {
          error: "Internal server error",
          requestId,
        },
        {
          status: 500,
          headers: { "x-request-id": requestId },
        }
      )
    }
  }
}
