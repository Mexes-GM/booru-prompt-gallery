import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Read our privacy policy to understand how Booru Prompt Gallery handles your local data, favorites, and history while using our AI art prompt tools.",
}

export default function PrivacyPage() {
  const lastUpdated = "February 15, 2026"

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
              <strong>Local Storage:</strong> Booru Prompt Gallery primarily uses your browser&apos;s Local Storage to save 
              your favorites, history, and application preferences. This data stays on your device.
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
            <CardTitle>2. Authentication & Account Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              When you choose to sign in to Booru Prompt Gallery, we use <strong>Magic Link</strong> (passwordless email) as our authentication provider.
              We are committed to data minimization and only request your email address.
            </p>
            {/* Google OAuth Temporarily Hidden
            <p>
              When you choose to sign in to Booru Prompt Gallery, we use <strong>Google OAuth</strong> as our authentication provider.
              We are committed to data minimization and only request the following limited permissions (scopes):
            </p>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              <li>
                <strong>openid</strong>: Used to associate you with your personal info on Google for authentication purposes.
              </li>
              <li>
                <strong>userinfo.email</strong>: Used to see your primary Google Account email address.
              </li>
            </ul>
            */}
            <p className="pt-2">
              <strong>How we use this data:</strong> Your email address is used solely as a unique identifier to link your account
              to your saved preferences, favorites, and history across devices. We do <strong>not</strong> share your email 
              with third parties or use it for marketing purposes.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>3. Third-Party Services</CardTitle>
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
            <CardTitle>4. Cookies</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              We do not use tracking cookies for marketing purposes. We use functional cookies required for 
              authentication and server-side features to maintain your session securely.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>5. Contact</CardTitle>
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
