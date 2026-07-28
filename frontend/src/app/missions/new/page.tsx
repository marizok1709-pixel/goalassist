"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";

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

const glassInput =
  "ob-glass w-full rounded-xl px-4 py-3 text-sm text-white";

export default function NewMissionPage() {
  const router = useRouter();
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
      <DarkShell>
        <div className="pt-20 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">
            ✓ Mission created
          </p>
          <h1 className="mt-5 text-5xl font-bold tracking-tight text-white">{launched.title}</h1>
          <p className="mt-3 text-white/60">
            Deadline{" "}
            {new Date(`${launched.deadline}T00:00:00`).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}
          </p>
          <motion.p
            className="mt-10 text-8xl font-bold text-white tnum"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {launched.days}
          </motion.p>
          <p className="text-lg text-white/70">days to get there</p>
          {launched.remaining.length > 0 && (
            <div className="ob-glass mx-auto mt-8 w-full max-w-sm rounded-2xl p-5 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                You&apos;ll need
              </p>
              <ul className="mt-3 space-y-1.5">
                {launched.remaining.map((r) => (
                  <li key={r.name} className="flex justify-between text-white/85">
                    <span className="truncate pr-3">{r.name}</span>
                    <span className="shrink-0 tnum">
                      {r.amount} {r.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-8 text-white/70">Your first day is prepared.</p>
          <button
            className="ob-btn mt-5 rounded-2xl px-10 py-4 text-lg font-semibold"
            onClick={() => router.push("/today")}
          >
            Start today →
          </button>
        </div>
      </DarkShell>
    );
  }

  return (
    <DarkShell>
      <div className="pt-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">New mission</h1>
        <p className="mt-1 text-sm text-white/55">
          A mission is a goal with a hard deadline and measurable material behind it.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <section className="ob-glass space-y-4 rounded-3xl p-6">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/50">
                Mission title
              </span>
              <input
                className={glassInput}
                placeholder='e.g. "Pass TestDaF TDN4"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/50">
                  Category
                </span>
                <input
                  className={glassInput}
                  placeholder="Language exam"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/50">
                  Started
                </span>
                <input
                  className={`${glassInput} ob-date`}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/50">
                  Deadline
                </span>
                <input
                  className={`${glassInput} ob-date`}
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  required
                />
              </label>
            </div>
            <p className="text-xs text-white/45">
              Already preparing for a while? Set &quot;Started&quot; to when you began — the
              trajectory is measured from there.
            </p>
          </section>

          <section className="ob-glass rounded-3xl p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">
              Materials
            </p>
            <p className="mt-1.5 text-xs text-white/45">
              The actual work: books, mock exams, vocabulary sets. The daily plan is computed
              automatically. If you&apos;re already partway through, put it in &quot;Done&quot;.
            </p>
            <div className="mt-4 space-y-3">
              {materials.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_90px_80px_32px] items-end gap-2">
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-white/45">Name</span>}
                    <input
                      className={glassInput}
                      placeholder="Mit Erfolg zum TestDaF"
                      value={m.name}
                      onChange={(e) => setMat(i, "name", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-white/45">Total</span>}
                    <input
                      className={glassInput}
                      type="number"
                      min="1"
                      placeholder="400"
                      value={m.total_quantity}
                      onChange={(e) => setMat(i, "total_quantity", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-white/45">Unit</span>}
                    <input
                      className={glassInput}
                      placeholder="pages"
                      value={m.unit}
                      onChange={(e) => setMat(i, "unit", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-white/45">Done</span>}
                    <input
                      className={glassInput}
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
                    className="pb-3 text-white/40 hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMaterials([...materials, { ...emptyMaterial }])}
              className="mt-4 text-sm text-white/60 hover:text-white/90"
            >
              + Add material
            </button>
          </section>

          {error && <p className="text-sm text-red-300">✕ {error}</p>}
          <button className="ob-btn w-full rounded-2xl px-8 py-4 text-base font-semibold" disabled={busy}>
            {busy ? "Creating…" : "Launch mission"}
          </button>
        </form>
      </div>
    </DarkShell>
  );
}
