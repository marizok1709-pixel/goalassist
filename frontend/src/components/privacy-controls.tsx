"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearToken } from "@/lib/api";
import { analytics, getConsent, setConsent } from "@/lib/analytics";
import { ErrorLine, SectionLabel } from "@/components/ui";

/**
 * The user-facing half of the privacy design: see it, take it, stop it, delete
 * it. Every control here maps to a right the regulation grants, and each one
 * does the real thing rather than filing a request — consent flips instantly,
 * export downloads immediately, deletion is irreversible and does not queue.
 */
export function PrivacyControls() {
  const router = useRouter();
  const [consent, setConsentState] = useState<boolean>(false);
  const [busy, setBusy] = useState<"consent" | "export" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    // Server is the source of truth for a signed-in account; fall back to the
    // local decision if the call fails so the toggle still reflects reality.
    api
      .getConsent()
      .then((c) => setConsentState(c.analytics_consent))
      .catch(() => setConsentState(getConsent() === "granted"));
  }, []);

  async function toggleConsent() {
    const next = !consent;
    setBusy("consent");
    setError("");
    setNote("");
    try {
      await api.setConsent(next);
      setConsent(next ? "granted" : "denied");
      setConsentState(next);
      setNote(
        next
          ? "Thanks — usage analytics are on."
          : "Analytics are off, and everything collected about you has been deleted.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    setBusy("export");
    setError("");
    setNote("");
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `goalassist-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote("Downloaded.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    setError("");
    try {
      await api.deleteMyAccount();
      analytics.clear();
      clearToken();
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
      setBusy(null);
    }
  }

  return (
    <section className="mt-12">
      <SectionLabel>Privacy and your data</SectionLabel>

      <div className="ob-glass mt-3 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <p className="text-[15px] font-semibold text-ink">Usage analytics</p>
            <p className="mt-1 text-sm text-ink-2">
              Which features get used, and whether the daily loop keeps working. Never the
              contents of your missions, never sold, never shared with advertisers.
            </p>
          </div>
          <button
            onClick={toggleConsent}
            disabled={busy === "consent"}
            aria-pressed={consent}
            className="ob-btn-quiet shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            {consent ? "Turn off" : "Turn on"}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Currently <span className="font-semibold text-ink-2">{consent ? "on" : "off"}</span>.
          Turning it off also deletes what has already been collected about you.
        </p>
      </div>

      <div className="ob-glass mt-3 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <p className="text-[15px] font-semibold text-ink">Download your data</p>
            <p className="mt-1 text-sm text-ink-2">
              Everything we hold about your account — profile, missions, materials, schedule and
              any analytics events — as one JSON file.
            </p>
          </div>
          <button
            onClick={exportData}
            disabled={busy === "export"}
            className="ob-btn-quiet shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            {busy === "export" ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>

      <div className="ob-glass mt-3 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <p className="text-[15px] font-semibold text-ink">Delete your account</p>
            <p className="mt-1 text-sm text-ink-2">
              Removes your account, every mission, the whole schedule and all analytics. This is
              immediate and cannot be undone.
            </p>
          </div>
          {!confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ob-btn-quiet shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold text-bad"
            >
              Delete
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm text-ink-2">
              Type <span className="font-semibold text-ink">DELETE</span> to confirm.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="ob-glass w-40 rounded-xl px-4 py-2 text-sm text-ink"
                aria-label="Type DELETE to confirm"
              />
              <button
                onClick={deleteAccount}
                disabled={confirmText !== "DELETE" || busy === "delete"}
                className="ob-btn rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-40"
              >
                {busy === "delete" ? "Deleting…" : "Delete everything"}
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmText("");
                }}
                className="text-sm text-ink-muted hover:text-ink"
              >
                cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {note && <p className="mt-3 text-sm text-good">{note}</p>}
      {error && <ErrorLine msg={error} />}
    </section>
  );
}
