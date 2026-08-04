"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { DarkShell, DayColumn } from "@/components/darkchrome";
import { DAYS, PageLoading } from "@/components/ui";

export default function TimingPage() {
  const router = useRouter();
  const [avail, setAvail] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    api
      .me()
      .then((u) => {
        setAvail(Object.fromEntries(DAYS.map((d) => [d.key, u.availability?.[d.key] ?? 0])));
      })
      .catch(() => {});
  }, [router]);

  const totalHours = avail ? DAYS.reduce((s, d) => s + (avail[d.key] || 0), 0) : 0;

  async function save() {
    if (!avail || totalHours === 0) return;
    setBusy(true);
    setSaved(false);
    try {
      await api.updateMe({ availability: avail });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DarkShell width="max-w-4xl">
      <div className="flex flex-col items-center pt-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-ink-2">Design your schedule</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">When can you actually study?</h1>
        <p className="mt-3 max-w-xl text-lg text-ink-2">
          Set your hours per day and every mission reshuffles around them — heavier days carry more
          work, a 0-hour day is a rest day. Until you set this, work spreads evenly across the week.
        </p>

        {!avail ? (
          <PageLoading rows={2} />
        ) : (
          <>
            <div className="mt-10 grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {DAYS.map((d) => (
                <DayColumn
                  key={d.key}
                  label={d.label}
                  hours={avail[d.key]}
                  onStep={(delta) =>
                    setAvail((prev) => ({
                      ...prev!,
                      [d.key]: Math.min(Math.max((prev![d.key] || 0) + delta, 0), 16),
                    }))
                  }
                />
              ))}
            </div>
            <p className="mt-5 text-base text-ink-2 tnum">{totalHours} h / week</p>

            <div className="mt-8 flex items-center gap-4">
              <button className="text-base text-ink-muted hover:text-ink" onClick={() => router.push("/")}>
                ← back to dashboard
              </button>
              <button
                className="ob-btn rounded-2xl px-8 py-3.5 text-base font-semibold"
                onClick={save}
                disabled={busy || totalHours === 0}
              >
                {busy ? "Saving…" : "Save & reschedule"}
              </button>
            </div>
            {saved && (
              <p className="mt-4 text-base text-good">
                ✓ Saved — every mission redistributed.{" "}
                <button className="underline hover:text-ink" onClick={() => router.push("/today")}>
                  See today →
                </button>
              </p>
            )}
            {totalHours === 0 && (
              <p className="mt-3 text-sm text-ink-muted">Give at least one day some hours to save.</p>
            )}
          </>
        )}
      </div>
    </DarkShell>
  );
}
