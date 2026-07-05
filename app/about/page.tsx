import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "About",
  description:
    "Booru Prompt Gallery extracts and cleans booru tags into ready-to-use prompts for AI art models like Illustrious, Pony, and SDXL.",
}

export default function AboutPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">About Booru Prompt Gallery</h1>

      <div className="grid gap-6">
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>Our Mission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Booru Prompt Gallery is a tool for AI artists and LoRA trainers. It browses posts from booru-style image
              boards, extracts their tags, cleans them, and formats them into ready-to-copy prompts — turning a manual,
              tedious workflow into a single click.
            </p>
            <p>
              It is tuned for <strong>booru-tag models</strong> such as <strong>Illustrious</strong>,{" "}
              <strong>Pony</strong>, and <strong>SDXL</strong>, where accurate, well-ordered tags matter most. The goal
              is to help you understand how tags shape a generation through interactive tag management, weighting, and
              cleaning.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>What It Does</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Multi-provider support:</strong> browse Danbooru, Gelbooru, e621, Aibooru, and Rule34.
              </li>
              <li>
                <strong>Smart prompt cleaning:</strong> strips metadata and resolves 180+ contradictory-tag rules (e.g.
                &quot;from behind&quot; blocks frontal-only tags).
              </li>
              <li>
                <strong>Categorized tags:</strong> Appearance, Clothing, Pose, Background, and Character — copy only what
                you need.
              </li>
              <li>
                <strong>Weights:</strong> set global or per-tag weights that apply as <code>(tag:1.5)</code> across every
                card.
              </li>
              <li>
                <strong>Presets:</strong> save tag packs for different LoRAs or styles.
              </li>
              <li>
                <strong>Merge mode:</strong> combine categories from multiple posts into one cohesive prompt.
              </li>
              <li>
                <strong>Favorites &amp; history:</strong> save posts locally, or sign in to sync across devices.
              </li>
              <li>
                <strong>Background options:</strong> keep, remove, replace, or randomize backgrounds per card.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>The Creator</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <div>
              <p className="mb-2">
                Created by <strong>Mexes</strong> — a developer and AI-art enthusiast building tools that make the
                creative process easier for everyone. Feedback and feature requests are welcome through the in-app
                Feedback tool.
              </p>
              <div className="flex gap-2">
                <Badge variant="outline">Developer</Badge>
                <Badge variant="outline">AI Artist</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
