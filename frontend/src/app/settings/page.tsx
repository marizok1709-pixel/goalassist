"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";
import { DAYS, Field, PageHeader, PageLoading, SectionLabel, glassInput } from "@/components/ui";
import { PrivacyControls } from "@/components/privacy-controls";

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
        <PageLoading />
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
        <PageHeader title="Settings" />

        <section className="ob-glass mt-8 rounded-3xl p-6">
          <SectionLabel>Profile</SectionLabel>
          <form onSubmit={saveProfile} className="mt-4 space-y-4">
            <Field label="Name" htmlFor="settings-name">
              <input
                id="settings-name"
                className={glassInput}
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                required
              />
            </Field>
            <Field label="University" htmlFor="settings-university">
              <input
                id="settings-university"
                className={glassInput}
                placeholder="TUM"
                value={profile.university}
                onChange={(e) => setProfile({ ...profile, university: e.target.value })}
              />
            </Field>
            <p className="text-xs text-ink-muted">Signed in as {email}</p>
            {saved === "profile" && <p className="text-sm text-good">✓ Profile saved.</p>}
            <button className="ob-btn rounded-xl px-6 py-2.5 text-sm font-semibold" disabled={busy}>
              Save profile
            </button>
          </form>
        </section>

        <section className="ob-glass mt-4 rounded-3xl p-6">
          <SectionLabel>Weekly availability</SectionLabel>
          <p className="mt-1.5 text-xs text-ink-muted">
            Study hours per weekday, 0 = rest day. Every mission&apos;s schedule redistributes
            around this — a 4-hour day carries twice the load of a 2-hour day.
          </p>
          <form onSubmit={saveAvailability} className="mt-4 space-y-2">
            {DAYS.map((d) => (
              <label key={d.key} htmlFor={`hours-${d.key}`} className="flex items-center justify-between gap-4">
                <span className={`text-sm ${Number(hours[d.key]) > 0 ? "text-ink" : "text-ink-muted"}`}>
                  {d.label}
                  {Number(hours[d.key]) === 0 && (
                    <span className="ml-2 text-[10px] font-semibold uppercase text-ink-muted">rest</span>
                  )}
                </span>
                <input
                  id={`hours-${d.key}`}
                  className="ob-glass w-24 rounded-xl px-4 py-2 text-right text-sm text-ink tnum"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="16"
                  step="0.5"
                  value={hours[d.key] ?? ""}
                  onChange={(e) => setHours({ ...hours, [d.key]: e.target.value })}
                />
              </label>
            ))}
            <p className="pt-1 text-right text-xs text-ink-muted tnum">{total} h/week</p>
            {saved === "availability" && (
              <p className="text-sm text-good">✓ Saved — all schedules redistributed.</p>
            )}
            <button
              className="ob-btn w-full rounded-xl px-6 py-3 text-sm font-semibold"
              disabled={busy || total === 0}
            >
              Save & reschedule
            </button>
            {total === 0 && (
              <p className="text-center text-xs text-bad">
                At least one day needs hours — the work has to land somewhere.
              </p>
            )}
          </form>
        </section>

        {error && <p className="mt-4 text-sm text-bad">✕ {error}</p>}
      </div>
      <PrivacyControls />
    </DarkShell>
  );
}
