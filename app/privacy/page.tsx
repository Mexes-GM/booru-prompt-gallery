import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy - Booru Prompt Gallery Data Handling",
  description: "Read our privacy policy to understand how Booru Prompt Gallery handles your local data, favorites, and history while using our AI art prompt tools.",
}

export default function PrivacyPage() {
  const lastUpdated = "February 13, 2026"

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-6">Last updated: {lastUpdated}</p>
      
      <div className="grid gap-6">
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>1. Data Collection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              <strong>Local Storage:</strong> Booru Prompt Gallery primarily uses your browser's Local Storage to save 
              your favorites, history, and application preferences. This data stays on your device and is not 
              automatically sent to our servers.
            </p>
            <p>
              <strong>Analytics:</strong> We use Vercel Analytics to collect anonymous usage data to help us 
              improve the tool. This includes information about which features are used most frequently, 
              but does not include personally identifiable information.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>2. Third-Party Services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              This application interacts with external APIs (Danbooru, Rule34, etc.) to fetch images and tags. 
              When you browse the gallery, your IP address may be visible to these third-party providers as 
              part of the standard web request process.
            </p>
            <p>
              We recommend reviewing the privacy policies of the booru providers you choose to use within the app.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>3. Cookies</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              We do not use tracking cookies for marketing purposes. We use functional cookies required for 
              server-side features like admin authentication if applicable.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>4. Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              If you have any questions about this privacy policy or how your data is handled, you can reach out 
              via the Feedback tool in the application.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
