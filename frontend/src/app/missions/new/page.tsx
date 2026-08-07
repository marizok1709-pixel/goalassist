"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";
import { TextField } from "@/components/textfield";
import { Field, glassInput } from "@/components/ui";

interface MaterialDraft {
  id: number; // stable key — uncontrolled inputs must not be reused across rows
  name: string;
  total_quantity: string;
  unit: string;
  already_completed: string;
}

let draftSeq = 0;
const newMaterial = (): MaterialDraft => ({
  id: ++draftSeq,
  name: "",
  total_quantity: "",
  unit: "pages",
  already_completed: "",
});

interface Launched {
  title: string;
  deadline: string;
  days: number;
  remaining: { amount: number; unit: string; name: string }[];
}

export default function NewMissionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [deadline, setDeadline] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [materials, setMaterials] = useState<MaterialDraft[]>(() => [newMaterial()]);
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
        <div className="pt-12 text-center sm:pt-20">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-ink-2">
            ✓ Mission created
          </p>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-ink sm:text-5xl">{launched.title}</h1>
          <p className="mt-3 text-ink-2">
            Deadline{" "}
            {new Date(`${launched.deadline}T00:00:00`).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}
          </p>
          <motion.p
            className="mt-8 text-7xl font-bold text-ink tnum sm:mt-10 sm:text-8xl"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {launched.days}
          </motion.p>
          <p className="text-lg text-ink-2">days to get there</p>
          {launched.remaining.length > 0 && (
            <div className="ob-glass mx-auto mt-8 w-full max-w-sm rounded-2xl p-5 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-2">
                You&apos;ll need
              </p>
              <ul className="mt-3 space-y-1.5">
                {launched.remaining.map((r) => (
                  <li key={r.name} className="flex justify-between text-ink">
                    <span className="truncate pr-3">{r.name}</span>
                    <span className="shrink-0 tnum">
                      {r.amount} {r.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-8 text-ink-2">Your first day is prepared.</p>
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
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">New mission</h1>
        <p className="mt-1 text-sm text-ink-muted">
          A mission is a goal with a hard deadline and measurable material behind it.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <section className="ob-glass space-y-4 rounded-3xl p-4 sm:p-6">
            <Field label="Mission title" htmlFor="new-title">
              <TextField
                id="new-title"
                className={glassInput}
                placeholder='e.g. "Pass TestDaF TDN4"'
                value={title}
                onValueChange={setTitle}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Category" htmlFor="new-category">
                <TextField
                  id="new-category"
                  className={glassInput}
                  placeholder="Language exam"
                  value={category}
                  onValueChange={setCategory}
                />
              </Field>
              <Field label="Started" htmlFor="new-started">
                <input
                  id="new-started"
                  className={`${glassInput} ob-date`}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="Deadline" htmlFor="new-deadline">
                <input
                  id="new-deadline"
                  className={`${glassInput} ob-date`}
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  required
                />
              </Field>
            </div>
            <p className="text-xs text-ink-muted">
              Already preparing for a while? Set &quot;Started&quot; to when you began — the
              trajectory is measured from there.
            </p>
          </section>

          <section className="ob-glass rounded-3xl p-4 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
              Materials
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">
              The actual work: books, mock exams, vocabulary sets. The daily plan is computed
              automatically. If you&apos;re already partway through, put it in &quot;Done&quot;.
            </p>
            {/* Five fixed columns need 282px before the name field gets a pixel
                — on a 360px screen that left it ~14px wide. The name takes its
                own row on a phone and the three small fields share the next one;
                DOM order is untouched, so desktop is exactly as it was. */}
            <div className="mt-4 space-y-3">
              {materials.map((m, i) => (
                <div
                  key={m.id}
                  className="grid grid-cols-[1fr_1fr_1fr_32px] items-end gap-2 sm:grid-cols-[1fr_80px_90px_80px_32px]"
                >
                  <label className="col-span-4 block sm:col-span-1">
                    {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Name</span>}
                    <TextField
                      className={glassInput}
                      placeholder="Mit Erfolg zum TestDaF"
                      aria-label={`Material ${i + 1} name`}
                      value={m.name}
                      onValueChange={(v) => setMat(i, "name", v)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Total</span>}
                    <input
                      className={glassInput}
                      type="number"
                      inputMode="decimal"
                      min="1"
                      placeholder="400"
                      aria-label={`Material ${i + 1} total`}
                      value={m.total_quantity}
                      onChange={(e) => setMat(i, "total_quantity", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Unit</span>}
                    <TextField
                      className={glassInput}
                      placeholder="pages"
                      aria-label={`Material ${i + 1} unit`}
                      value={m.unit}
                      onValueChange={(v) => setMat(i, "unit", v)}
                    />
                  </label>
                  <label className="block">
                    {i === 0 && <span className="mb-1 block text-[11px] text-ink-muted">Done</span>}
                    <input
                      className={glassInput}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="0"
                      aria-label={`Material ${i + 1} already done`}
                      value={m.already_completed}
                      onChange={(e) => setMat(i, "already_completed", e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Remove material"
                    onClick={() => setMaterials(materials.filter((_, j) => j !== i))}
                    className="pb-3 text-ink-muted hover:text-bad"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMaterials([...materials, newMaterial()])}
              className="mt-2 inline-block py-2.5 text-sm text-ink-2 hover:text-ink"
            >
              + Add material
            </button>
          </section>

          {error && <p className="text-sm text-bad">✕ {error}</p>}
          <button className="ob-btn w-full rounded-2xl px-8 py-4 text-base font-semibold" disabled={busy}>
            {busy ? "Creating…" : "Launch mission"}
          </button>
        </form>
      </div>
    </DarkShell>
  );
}
