import { DarkShell } from "@/components/darkchrome";

export const metadata = { title: "Support — Goal Assist" };

export default function SupportPage() {
  return (
    <DarkShell>
      <div className="pt-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Support</h1>
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-white/70">
          <p>
            Something broken, confusing, or missing? Tell us — during the pre-beta every report
            genuinely shapes the product.
          </p>
          <div className="ob-glass rounded-2xl p-5">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/50">Email</p>
            <a
              href="mailto:markmitrofanov.de@gmail.com?subject=Goal%20Assist%20support"
              className="mt-1 block text-xl font-semibold text-white underline"
            >
              markmitrofanov.de@gmail.com
            </a>
          </div>
          <p className="text-sm text-white/45">
            Include what you were doing and what you expected to happen — it makes fixes much faster.
          </p>
        </div>
      </div>
    </DarkShell>
  );
}
