"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const glassInput = "ob-glass w-full rounded-xl px-4 py-2.5 text-sm text-white";

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ name: string; university: string } | null>(null);
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<"profile" | "availability" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    api
      .me()
      .then((u) => {
        setProfile({ name: u.name, university: u.university ?? "" });
        setEmail(u.email);
        const initial: Record<string, string> = {};
        for (const d of DAYS) initial[d.key] = String(u.availability?.[d.key] ?? 2);
        setHours(initial);
      })
      .catch(() => {});
  }, [router]);

  if (!profile) {
    return (
      <DarkShell>
        <p className="py-24 text-center text-white/50">loading…</p>
      </DarkShell>
    );
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      await api.updateMe({ name: profile!.name, university: profile!.university || undefined });
      setSaved("profile");
    } catch {
      setError("Could not save. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  async function saveAvailability(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      const availability: Record<string, number> = {};
      for (const d of DAYS) availability[d.key] = Math.max(Number(hours[d.key]) || 0, 0);
      await api.updateMe({ availability });
      setSaved("availability");
    } catch {
      setError("Could not save. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const total = DAYS.reduce((s, d) => s + (Number(hours[d.key]) || 0), 0);

  return (
    <DarkShell width="max-w-md">
      <div className="pt-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>

        <section className="ob-glass mt-7 rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">Profile</p>
          <form onSubmit={saveProfile} className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-white/50">Name</span>
              <input
                className={glassInput}
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-white/50">University</span>
              <input
                className={glassInput}
                placeholder="TUM"
                value={profile.university}
                onChange={(e) => setProfile({ ...profile, university: e.target.value })}
              />
            </label>
            <p className="text-xs text-white/45">Signed in as {email}</p>
            {saved === "profile" && <p className="text-sm text-emerald-300">✓ Profile saved.</p>}
            <button className="ob-btn rounded-xl px-6 py-2.5 text-sm font-semibold" disabled={busy}>
              Save profile
            </button>
          </form>
        </section>

        <section className="ob-glass mt-5 rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
            Weekly availability
          </p>
          <p className="mt-1.5 text-xs text-white/45">
            Study hours per weekday, 0 = rest day. Every mission&apos;s schedule redistributes
            around this — a 4-hour day carries twice the load of a 2-hour day.
          </p>
          <form onSubmit={saveAvailability} className="mt-4 space-y-2">
            {DAYS.map((d) => (
              <label key={d.key} className="flex items-center justify-between gap-4">
                <span className={`text-sm ${Number(hours[d.key]) > 0 ? "text-white/85" : "text-white/45"}`}>
                  {d.label}
                  {Number(hours[d.key]) === 0 && (
                    <span className="ml-2 text-[10px] font-semibold uppercase text-white/40">rest</span>
                  )}
                </span>
                <input
                  className="ob-glass w-24 rounded-xl px-4 py-2 text-right text-sm text-white tnum"
                  type="number"
                  min="0"
                  max="16"
                  step="0.5"
                  value={hours[d.key] ?? ""}
                  onChange={(e) => setHours({ ...hours, [d.key]: e.target.value })}
                />
              </label>
            ))}
            <p className="pt-1 text-right text-xs text-white/45 tnum">{total} h/week</p>
            {saved === "availability" && (
              <p className="text-sm text-emerald-300">✓ Saved — all schedules redistributed.</p>
            )}
            <button
              className="ob-btn w-full rounded-xl px-6 py-3 text-sm font-semibold"
              disabled={busy || total === 0}
            >
              Save & reschedule
            </button>
            {total === 0 && (
              <p className="text-center text-xs text-red-300">
                At least one day needs hours — the work has to land somewhere.
              </p>
            )}
          </form>
        </section>

        {error && <p className="mt-4 text-sm text-red-300">✕ {error}</p>}
      </div>
    </DarkShell>
  );
}
