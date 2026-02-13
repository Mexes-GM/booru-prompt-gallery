import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "About Booru Prompt Gallery - Project Mission and Features",
  description: "Learn more about Booru Prompt Gallery, our mission to simplify AI art prompts, and the features that make tag extraction and cleaning easier for everyone.",
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
              Booru Prompt Gallery is a tool designed for AI artists and enthusiasts. We provide a streamlined 
              interface to browse images from popular booru-style image boards and extract high-quality, 
              cleaned prompts for use in Stable Diffusion, Midjourney, and other AI generation tools.
            </p>
            <p>
              Our primary goal is to help users understand how tags influence image generation by providing 
              interactive tag management, weighting, and cleaning utilities.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>Features</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Multi-Provider Support:</strong> Browse Danbooru, Aibooru, Rule34, Gelbooru, and e621.</li>
              <li><strong>Prompt Cleaning:</strong> Automatically remove unnecessary metadata and redundant tags.</li>
              <li><strong>Interactive Weights:</strong> Adjust tag importance using a visual interface.</li>
              <li><strong>Merge Mode:</strong> Combine multiple images into a single cohesive prompt.</li>
              <li><strong>Trending Tags:</strong> Discover what the community is creating right now.</li>
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
                Created by <strong>Mexes</strong>. I&apos;m a developer and AI art enthusiast dedicated to creating 
                tools that make the creative process easier for everyone.
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
