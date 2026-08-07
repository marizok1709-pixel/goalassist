import { DarkShell } from "@/components/darkchrome";

export const metadata = { title: "Policies & Data — Goal Assist" };

export default function PoliciesPage() {
  return (
    <DarkShell>
      <div className="pt-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Policies &amp; data</h1>
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-ink-2">
          <p>
            Goal Assist stores only what it needs to run your plan: your name, email, an encrypted
            password, your missions, materials, progress, and weekly availability. That&apos;s it.
          </p>
          <p>
            <span className="font-semibold text-ink">No selling, no ads, no tracking.</span> Your
            study data is never sold or shared with advertisers, and there are no third-party
            trackers in the app.
          </p>
          <p>
            <span className="font-semibold text-ink">Your data is yours.</span> You can request a
            full export or permanent deletion of your account and everything in it at any time —
            email{" "}
            <a href="mailto:markmitrofanov.de@gmail.com" className="text-ink underline">
              markmitrofanov.de@gmail.com
            </a>
            .
          </p>
          <p className="text-sm text-ink-muted">
            This is a pre-beta product; this page is a plain-language summary, not a formal legal
            document. A full policy lands before public launch.
          </p>
        </div>
      </div>
    </DarkShell>
  );
}
