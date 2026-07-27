import { DarkShell } from "@/components/darkchrome";

export const metadata = { title: "Social — Goal Assist" };

export default function SocialPage() {
  return (
    <DarkShell>
      <div className="pt-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Social media</h1>
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-white/70">
          <p>
            Goal Assist is in pre-beta and building in the open. Follow the progress, share what you
            think is broken, and help decide what gets built next.
          </p>
          <div className="ob-glass rounded-2xl p-5">
            <p className="text-sm text-white/60">
              Channels are being set up. In the meantime, reach the maker directly at{" "}
              <a href="mailto:markmitrofanov.de@gmail.com" className="text-white underline">
                markmitrofanov.de@gmail.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </DarkShell>
  );
}
