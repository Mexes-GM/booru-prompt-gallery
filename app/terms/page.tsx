import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of Booru Prompt Gallery, including acceptable use, third-party content, mature content, and disclaimers.",
}

export default function TermsPage() {
  const lastUpdated = "July 4, 2026"

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-muted-foreground mb-6">Last updated: {lastUpdated}</p>

      <div className="grid gap-6">
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>1. Acceptance of Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              By accessing or using Booru Prompt Gallery (&quot;the app&quot;), you agree to these Terms of Service and to
              our{" "}
              <Link href="/privacy" className="underline hover:text-primary">
                Privacy Policy
              </Link>
              . If you do not agree, please do not use the app.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>2. What the App Is</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              The app is a free utility that fetches images and tags from third-party booru-style image boards and
              formats them into text prompts for AI art tools. It does not host image content itself; images and tags are
              served by their respective providers.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>3. Eligibility &amp; Mature Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Some supported providers (including Rule34 and e621) contain explicit or mature (NSFW) material. You must be
              of legal age in your jurisdiction — <strong>at least 18 years old</strong> — to view such content. You are
              solely responsible for enabling or disabling the content filter and for the material you choose to display.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>4. Acceptable Use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              <li>Use the app for any unlawful purpose or in violation of any applicable law.</li>
              <li>Abuse, overload, scrape, or circumvent rate limits on the app or the third-party APIs it uses.</li>
              <li>Attempt to disrupt, reverse-engineer for malicious ends, or gain unauthorized access to the service.</li>
              <li>Use the app to access or generate content that is illegal in your jurisdiction.</li>
            </ul>
            <p>
              We may restrict or suspend access if the service is misused or if usage threatens the stability of the app
              or its providers.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>5. Third-Party Content &amp; Intellectual Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              All images, tags, and metadata are the property of their respective owners and providers and are subject to
              those providers&apos; own terms. The app makes no ownership claim over third-party content. Prompts you
              generate are yours to use; you are responsible for how you use them and for complying with the terms of any
              AI model or platform you use them with.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>6. Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Accounts are optional and used only to sync favorites and preferences. You are responsible for maintaining
              access to the email associated with your account. You may request account deletion at any time via the
              in-app Feedback tool.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>7. Disclaimer of Warranties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              The app is provided <strong>&quot;as is&quot;</strong> and <strong>&quot;as available&quot;</strong>,
              without warranties of any kind, express or implied. We do not guarantee that the service will be
              uninterrupted, error-free, or that third-party providers will remain available. Availability of any
              provider or feature may change or be removed at any time.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>8. Limitation of Liability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              To the maximum extent permitted by law, Booru Prompt Gallery and its creator shall not be liable for any
              indirect, incidental, or consequential damages arising from your use of the app or from content served by
              third-party providers. As the app is provided free of charge, any direct liability is limited to the
              greatest extent permitted by law.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>9. Changes to These Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              We may update these Terms from time to time. Material changes will be reflected in the &quot;Last
              updated&quot; date above. Continued use of the app after changes constitutes acceptance of the revised
              Terms.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>10. Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Questions about these Terms? Reach out via the <strong>Feedback</strong> tool in the app.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
