import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Booru Prompt Gallery handles your data: local storage, optional accounts, analytics, error tracking, and the third-party services involved.",
}

export default function PrivacyPage() {
  const lastUpdated = "July 4, 2026"

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-6">Last updated: {lastUpdated}</p>

      <div className="grid gap-6">
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>1. Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Booru Prompt Gallery (&quot;the app&quot;, &quot;we&quot;) is a tool for browsing booru-style image boards and
              turning their tags into clean prompts. It is built around <strong>data minimization</strong>: you can use
              almost every feature without an account, and most of your data never leaves your own browser.
            </p>
            <p>
              This page explains exactly what data is stored, where it lives, and which third parties are involved.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>2. Data Stored on Your Device</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              By default the app stores everything locally in your browser&apos;s <strong>Local Storage</strong> — no
              account required and nothing is sent to our servers:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              <li>Favorites (when you are not signed in)</li>
              <li>Copy history and recent tags</li>
              <li>Presets, blacklist, tag weights, and content filter preferences</li>
              <li>UI settings such as provider selection, card scale, and dismissed announcements</li>
            </ul>
            <p>
              You can clear all of this at any time by clearing your browser&apos;s site data for this domain.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>3. Accounts &amp; Cloud Sync (Optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Signing in is entirely optional and only exists to <strong>sync your favorites and preferences across
              devices</strong>. Authentication uses a passwordless <strong>Magic Link</strong> sent to your email, so we
              never handle or store a password.
            </p>
            <p>
              <strong>What we collect:</strong> only your <strong>email address</strong>, used solely as the unique
              identifier that links your account to your synced favorites and settings. We do not use it for marketing
              and we do not sell or share it.
            </p>
            <p>
              <strong>Where it lives:</strong> account and synced data are stored in <strong>Supabase</strong> (a hosted
              PostgreSQL provider) acting as our data processor. See{" "}
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary"
              >
                Supabase&apos;s privacy policy
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>4. Analytics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              We use <strong>Cloudflare Web Analytics</strong>, which is privacy-first and{" "}
              <strong>cookieless</strong> — it does not fingerprint you or track you across sites. Depending on the
              hosting platform, <strong>Vercel Analytics</strong> may also collect anonymous page views. Neither
              includes personally identifiable information; both are used only to understand aggregate usage and improve
              the app.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>5. Error Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              To diagnose crashes we use <strong>Sentry</strong>. Diagnostic data (such as the error, a technical
              breadcrumb trail of in-app actions, and basic device/browser info) is only transmitted{" "}
              <strong>when an error actually occurs</strong>. We do not send your prompts, favorites, or browsing content
              as part of normal use.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>6. Third-Party Booru Providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Images and tags are fetched from external providers (Danbooru, Gelbooru, e621, Aibooru, Rule34). When you
              browse, requests to these providers (sometimes via our image proxy) may expose your IP address to them as
              part of the normal web request process. We do not control their data practices and recommend reviewing the
              privacy policy of any provider you use.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>7. Cookies</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              We do not use advertising or cross-site tracking cookies. We use only the functional cookies required to
              keep you signed in and to maintain a secure session.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>8. Data Retention &amp; Your Rights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Local data stays until you clear it. Account data is retained while your account exists. You have the right
              to <strong>access, correct, or delete</strong> your data.
            </p>
            <p>
              <strong>Deleting your account:</strong> request deletion through the in-app Feedback tool. On deletion we
              remove your account record and associated synced favorites/preferences from Supabase. You can also stop
              syncing at any time by signing out and clearing your local site data.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>9. Age Restriction &amp; Mature Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Some supported providers host explicit or mature (NSFW) content. The app is intended for adults and you
              must be of legal age in your jurisdiction (at least 18) to view such content. A content filter is enabled
              where applicable, but you are responsible for the material you choose to display.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>10. Changes &amp; Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              We may update this policy; material changes will be reflected in the &quot;Last updated&quot; date above.
              See also our{" "}
              <Link href="/terms" className="underline hover:text-primary">
                Terms of Service
              </Link>
              .
            </p>
            <p>
              Questions about your data or this policy? Reach out via the <strong>Feedback</strong> tool in the app.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
