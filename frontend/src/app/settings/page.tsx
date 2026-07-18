"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { btnPrimary, ErrorNote, inputCls, Spinner } from "@/components/ui";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

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
      router.push("/login");
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

  if (!profile) return <Spinner />;

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
    <div className="mx-auto max-w-md">
      <h1 className="font-serif text-2xl font-semibold text-ink">Settings</h1>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink-muted">Profile</p>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Name</span>
            <input
              className={inputCls}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">University</span>
            <input
              className={inputCls}
              placeholder="TUM"
              value={profile.university}
              onChange={(e) => setProfile({ ...profile, university: e.target.value })}
            />
          </label>
          <p className="text-xs text-ink-muted">Signed in as {email}</p>
          {saved === "profile" && <p className="text-sm text-good">✓ Profile saved.</p>}
          <button className={btnPrimary} disabled={busy}>
            Save profile
          </button>
        </form>
      </section>

      <section className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink-muted">
          Weekly availability
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Study hours per weekday, 0 = rest day. Every mission&apos;s schedule redistributes
          around this — a 4-hour day carries twice the load of a 2-hour day.
        </p>
        <form onSubmit={saveAvailability} className="mt-3 space-y-2">
          {DAYS.map((d) => (
            <label key={d.key} className="flex items-center justify-between gap-4">
              <span
                className={`text-sm ${Number(hours[d.key]) > 0 ? "text-ink-2" : "text-ink-muted"}`}
              >
                {d.label}
                {Number(hours[d.key]) === 0 && (
                  <span className="ml-2 text-[10px] font-medium uppercase text-ink-muted">
                    rest
                  </span>
                )}
              </span>
              <input
                className={`${inputCls} w-24 text-right`}
                type="number"
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
          <button className={`${btnPrimary} w-full`} disabled={busy || total === 0}>
            Save & reschedule
          </button>
          {total === 0 && (
            <p className="text-center text-xs text-critical">
              At least one day needs hours — the work has to land somewhere.
            </p>
          )}
        </form>
      </section>

      {error && <div className="mt-4"><ErrorNote message={error} /></div>}
    </div>
  );
}
