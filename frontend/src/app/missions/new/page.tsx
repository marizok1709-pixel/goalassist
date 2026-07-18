"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { btnGhost, btnPrimary, ErrorNote, inputCls } from "@/components/ui";

interface MaterialDraft {
  name: string;
  total_quantity: string;
  unit: string;
  already_completed: string;
}

const emptyMaterial: MaterialDraft = {
  name: "",
  total_quantity: "",
  unit: "pages",
  already_completed: "",
};

interface Launched {
  title: string;
  deadline: string;
  days: number;
  remaining: { amount: number; unit: string; name: string }[];
}

export default function NewMissionPage() {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [deadline, setDeadline] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [materials, setMaterials] = useState<MaterialDraft[]>([{ ...emptyMaterial }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<Launched | null>(null);

  function setMat(i: number, field: keyof MaterialDraft, value: string) {
    setMaterials(materials.map((m, j) => (j === i ? { ...m, [field]: value } : m)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const goal = await api.createGoal({
        title,
        category: category || undefined,
        deadline,
        start_date: startDate || undefined,
      });
      const remaining: Launched["remaining"] = [];
      for (const m of materials) {
        if (!m.name || !m.total_quantity) continue;
        await api.addMaterial(goal.id, {
          name: m.name,
          total_quantity: Number(m.total_quantity),
          unit: m.unit || "units",
          already_completed: m.already_completed ? Number(m.already_completed) : undefined,
        });
        remaining.push({
          amount: Number(m.total_quantity) - (Number(m.already_completed) || 0),
          unit: m.unit || "units",
          name: m.name,
        });
      }
      const days = Math.max(
        Math.round(
          (new Date(`${deadline}T00:00:00`).getTime() - Date.now()) / (24 * 3600 * 1000)
        ),
        0
      );
      setLaunched({ title, deadline, days, remaining });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cannot reach the server");
      setBusy(false);
    }
  }

  // The emotional moment: the mission exists, the plan is ready.
  if (launched) {
    return (
      <div className="mx-auto mt-12 max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-good">
          ✓ Mission created
        </p>
        <h1 className="mt-4 font-serif text-4xl font-semibold text-ink">{launched.title}</h1>
        <p className="mt-3 text-ink-2">
          Deadline{" "}
          {new Date(`${launched.deadline}T00:00:00`).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
          })}
        </p>
        <p className="mt-6 font-serif text-6xl font-semibold text-accent tnum">{launched.days}</p>
        <p className="text-sm text-ink-muted">days to get there</p>
        {launched.remaining.length > 0 && (
          <div className="mx-auto mt-6 max-w-xs rounded-xl border border-line bg-surface p-4 text-sm shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink-muted">
              You&apos;ll need
            </p>
            <ul className="mt-2 space-y-1">
              {launched.remaining.map((r) => (
                <li key={r.name} className="flex justify-between text-ink-2">
                  <span className="truncate pr-3">{r.name}</span>
                  <span className="shrink-0 tnum">
                    {r.amount} {r.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-6 text-sm text-ink-2">Your first day is prepared.</p>
        <Link
          href="/today"
          className="mt-4 inline-block rounded-lg bg-accent px-10 py-3 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          Start today →
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold text-ink">New mission</h1>
      <p className="mt-1 text-sm text-ink-muted">
        A mission is a goal with a hard deadline and measurable material behind it.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section className="rounded-lg border border-line bg-surface p-5 space-y-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-ink-muted">
              Mission title
            </span>
            <input
              className={inputCls}
              placeholder='e.g. "Pass TestDaF TDN4"'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Category
              </span>
              <input
                className={inputCls}
                placeholder="Language exam"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Started
              </span>
              <input
                className={inputCls}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Deadline
              </span>
              <input
                className={inputCls}
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            Already preparing for a while? Set &quot;Started&quot; to when you began — the
            trajectory is measured from there.
          </p>
        </section>

        <section className="rounded-lg border border-line bg-surface p-5">
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
            Materials
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            The actual work: books, mock exams, vocabulary sets. The daily plan is computed
            automatically. If you&apos;re already partway through, put it in &quot;Done&quot;.
          </p>
          <div className="mt-3 space-y-3">
            {materials.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_100px_90px_32px] items-end gap-2">
                <label className="block">
                  {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Name</span>}
                  <input
                    className={inputCls}
                    placeholder="Mit Erfolg zum TestDaF"
                    value={m.name}
                    onChange={(e) => setMat(i, "name", e.target.value)}
                  />
                </label>
                <label className="block">
                  {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Total</span>}
                  <input
                    className={inputCls}
                    type="number"
                    min="1"
                    placeholder="400"
                    value={m.total_quantity}
                    onChange={(e) => setMat(i, "total_quantity", e.target.value)}
                  />
                </label>
                <label className="block">
                  {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Unit</span>}
                  <input
                    className={inputCls}
                    placeholder="pages"
                    value={m.unit}
                    onChange={(e) => setMat(i, "unit", e.target.value)}
                  />
                </label>
                <label className="block">
                  {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Done</span>}
                  <input
                    className={inputCls}
                    type="number"
                    min="0"
                    placeholder="0"
                    value={m.already_completed}
                    onChange={(e) => setMat(i, "already_completed", e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  aria-label="Remove material"
                  onClick={() => setMaterials(materials.filter((_, j) => j !== i))}
                  className="pb-2 text-ink-muted hover:text-critical"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMaterials([...materials, { ...emptyMaterial }])}
            className={`${btnGhost} mt-3`}
          >
            + Add material
          </button>
        </section>

        {error && <ErrorNote message={error} />}
        <button className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "Creating…" : "Launch mission"}
        </button>
      </form>
    </div>
  );
}
