
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@supabase/supabase-js"
import { verifyTurnstile } from "@/lib/turnstile"

// Validation Schema
// Hardened Validation Schema
const feedbackSchema = z.object({
    type: z.enum(["bug", "feature", "general", "other"]),
    content: z.string().min(1).max(2000).trim(), // Trim whitespace
    contact_info: z.string().max(100).optional().nullable(), // Limit length
    metadata: z.record(z.string(), z.any()).optional().default({}),
    honeypot: z.string().optional(), // Honeypot field
    turnstile_token: z.string().max(2048).optional(), // Cloudflare Turnstile token
})

const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3 // 3 requests per hour


export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const result = feedbackSchema.safeParse(body)

        if (!result.success) {
            return NextResponse.json(
                { error: "Invalid input", details: result.error.flatten() },
                { status: 400 }
            )
        }

        // 0. Honeypot check
        if (result.data.honeypot) {
            return NextResponse.json({ success: true }) // Fake success
        }

        const { type, content, contact_info, metadata } = result.data

        // 1. Rate Limiting (Database based - simple)
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"
        const userAgent = req.headers.get("user-agent") || "unknown"

        // 0.5 Cloudflare Turnstile verification (no-op when not configured)
        const turnstile = await verifyTurnstile(result.data.turnstile_token, ip)
        if (!turnstile.ok) {
            return NextResponse.json(
                { error: "Verification failed. Please try again." },
                { status: 403 }
            )
        }

        // Skip rate limit for localhost/development if needed, but better to test it.

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error("Missing Supabase credentials")
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Check rate limit
        if (ip !== "unknown" && ip !== "::1" && ip !== "127.0.0.1") {
            const { count, error: countError } = await supabase
                .from("rate_limits")
                .select("*", { count: "exact", head: true })
                .eq("ip", ip)
                .eq("action", "feedback")
                .gt("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString())

            if (!countError && count !== null && count >= MAX_REQUESTS_PER_WINDOW) {
                return NextResponse.json(
                    { error: "Too many requests. Please try again later." },
                    { status: 429 }
                )
            }

            // Log this request for rate limiting
            await supabase.from("rate_limits").insert({
                ip,
                action: "feedback"
            })
        }

        // 2. Save to Supabase
        const { error: dbError } = await supabase
            .from("feedback")
            .insert({
                type,
                content, // Text is stored as-is, sanitize on display!
                contact_info,
                metadata: {
                    ...metadata,
                    ip_hash: "REDACTED", // Don't store raw IP in permanent metadata
                    user_agent: userAgent.substring(0, 200) // Truncate UA
                },
                status: "new",
            })

        if (dbError) {
            console.error("Supabase Error:", dbError)
            return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 })
        }

        // 2. Trigger Discord Webhook (Fire & Forget)
        const discordWebhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK_URL
        if (discordWebhookUrl) {
            // Don't await this to speed up response time, or use waitUntil if available (Edge/Vercel)
            // Fire-and-forget with timeout to avoid blocking the response.

            const payload = {
                embeds: [
                    {
                        title: `New Feedback: ${type.toUpperCase()}`,
                        color: type === 'bug' ? 15158332 : type === 'feature' ? 3066993 : 3447003, // Red, Green, Blue
                        fields: [
                            { name: "Content", value: content.substring(0, 1024) },
                            { name: "Contact", value: contact_info || "Anonymous", inline: true },
                            { name: "Platform", value: metadata?.user_agent ? "Web" : "Unknown", inline: true },
                        ],
                        footer: { text: "Booru Gallery Feedback System" },
                        timestamp: new Date().toISOString(),
                    },
                ],
            }

            // We await it to ensure it sends before lambda dies
            try {
                await fetch(discordWebhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                })
            } catch (err) {
                console.error("Discord Webhook failed:", err)
                // Consume error, don't fail the request
            }
        }

        return NextResponse.json({ success: true })

    } catch (err) {
        console.error("Feedback error:", err)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
