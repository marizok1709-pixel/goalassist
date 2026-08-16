"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { api, ApiError, Plan, ScheduledTask } from "@/lib/api";
import { DarkFinishBar, DarkShell, DarkVerdictBadge } from "@/components/darkchrome";
import { TextField } from "@/components/textfield";
import { DataTable, EmptyState, PageLoading, StatTile, TabButton } from "@/components/ui";
import { analytics } from "@/lib/analytics";

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const goalId = Number(id);
  const router = useRouter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<ScheduledTask[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTask[]>([]);
  const [tab, setTab] = useState<"schedule" | "history">("schedule");
  const [editOpen, setEditOpen] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Material definition editing — materials used to be write-once, so a typo
  // made during onboarding was permanent.
  const [defineOpen, setDefineOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", total: "", unit: "" });
  const [removeArmed, setRemoveArmed] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: "", total: "", unit: "pages", done: "" });
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const [p, h, s] = await Promise.all([
      api.plan(goalId),
      api.history(goalId),
      api.schedule(goalId, 14),
    ]);
    setPlan(p);
    setHistory(h);
    setSchedule(s);
  }, [goalId]);

  useEffect(() => {
    load().catch(() => router.push("/"));
  }, [load, router]);

  if (!plan) {
    return (
      <DarkShell width="max-w-3xl">
        <PageLoading />
      </DarkShell>
    );
  }

  const r = plan.reality;

  function toggleEdit(materialId: number, completed: number) {
    if (editOpen === materialId) {
      setEditOpen(null);
      return;
    }
    setEditValue(String(completed));
    setEditOpen(materialId);
  }

  /** Every write goes through here so failures surface instead of dying silently. */
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError("");
    try {
      await action();
      after?.();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(materialId: number) {
    const value = Number(editValue);
    if (editValue.trim() === "" || Number.isNaN(value) || value < 0) return;
    analytics.track("material_edited", { kind: "progress" });
    await run(() => api.setMaterialProgress(goalId, materialId, value), () => setEditOpen(null));
  }

  function toggleDefine(m: { material_id: number; name: string; total: number; unit: string }) {
    setRemoveArmed(null);
    if (defineOpen === m.material_id) {
      setDefineOpen(null);
      return;
    }
    setEditOpen(null);
    setDraft({ name: m.name, total: String(m.total), unit: m.unit });
    setDefineOpen(m.material_id);
  }

  async function submitDefine(materialId: number) {
    const total = Number(draft.total);
    if (!draft.name.trim() || !draft.unit.trim() || Number.isNaN(total) || total <= 0) return;
    await run(
      () =>
        api.editMaterial(goalId, materialId, {
          name: draft.name.trim(),
          total_quantity: total,
          unit: draft.unit.trim(),
        }),
      () => setDefineOpen(null),
    );
  }

  async function removeMaterial(materialId: number) {
    analytics.track("material_removed");
    await run(() => api.deleteMaterial(goalId, materialId), () => {
      setRemoveArmed(null);
      setDefineOpen(null);
    });
  }

  async function submitAdd() {
    const total = Number(addDraft.total);
    if (!addDraft.name.trim() || Number.isNaN(total) || total <= 0) return;
    await run(
      () =>
        api.addMaterial(goalId, {
          name: addDraft.name.trim(),
          total_quantity: total,
          unit: addDraft.unit.trim() || "units",
          already_completed: Number(addDraft.done) || 0,
        }),
      () => {
        setAddOpen(false);
        setAddDraft({ name: "", total: "", unit: "pages", done: "" });
      },
    );
  }

  async function deleteMission() {
    setBusy(true);
    setActionError("");
    try {
      analytics.track("mission_deleted");
      await api.deleteGoal(goalId);
      router.push("/");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Cannot reach the server");
      setBusy(false);
    }
  }

  return (
    <DarkShell width="max-w-3xl">
      <div className="pt-6">
        {/* Title and status stack on a phone — side by side, a long mission
            title gets squeezed into a two-word-per-line column. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
              Mission{plan.goal.category ? ` · ${plan.goal.category}` : ""}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {plan.goal.title}
            </h1>
          </div>
          <div className="shrink-0 sm:pt-1">
            <DarkVerdictBadge verdict={r.verdict} />
          </div>
        </div>

        {/* Four tiles cut around the date rather than around percentages.
            "Trajectory 84%" is a ratio of two numbers a student never chose;
            a finish date and a pace in their own units are both checkable. */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Days left" value={String(r.days_remaining)} sub={`of ${r.days_total}`} />
          <StatTile
            label="Finishes"
            value={r.projected_finish ? fmtDay(r.projected_finish) : "—"}
            sub={r.days_late > 0 ? `${r.days_late}d late` : "on time"}
          />
          <StatTile label="Planned pace" value={`${r.pace_planned_units}/day`} />
          <StatTile
            label="Your pace"
            value={r.pace_actual_units !== null ? `${r.pace_actual_units}/day` : "—"}
            sub={r.pace_actual_units !== null ? "last 7 logged days" : "nothing logged yet"}
          />
        </div>

        <div className="mt-6">
          <DarkFinishBar
            startDate={plan.goal.start_date}
            deadline={plan.goal.deadline}
            projectedFinish={r.projected_finish}
          />
        </div>

        <div className="ob-glass mt-6 rounded-2xl px-5 py-4">
          <p className="text-sm text-ink">{r.message}</p>
          {r.load_changed && (
            <p className="mt-2 text-sm text-warn">
              → Your plan got heavier since you last looked.
            </p>
          )}
          {plan.goal.launched_over_capacity && (
            <p className="mt-2 text-xs text-ink-muted">
              You started this one knowing it didn&apos;t fit.
            </p>
          )}
        </div>

        <section className="mt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
            Materials · required pace
          </p>
          <ul className="mt-3 space-y-2">
            {plan.materials.map((m) => (
              <li key={m.material_id} className="ob-glass overflow-hidden rounded-2xl">
                {/* Phone: name on its own line, then the numbers, then the two
                    actions as real tap targets. Desktop keeps the single row. */}
                <div className="px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:px-5 sm:py-3.5">
                  <span className="block text-[15px] text-ink sm:flex-1">{m.name}</span>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 sm:contents">
                    <span className="text-sm text-ink-2 tnum">
                      {m.completed} / {m.total} {m.unit}
                    </span>
                    <span className="text-xs text-ink tnum">{m.human_rate}</span>
                  </div>
                  {/* `edit` is four characters wide — tall enough on its own but
                      only ~22px across, which is not a thumb target. The
                      horizontal padding is what makes it one. */}
                  <div className="-mb-1 -ml-2 mt-1 flex items-center gap-2 sm:contents">
                    <button
                      onClick={() => toggleEdit(m.material_id, m.completed)}
                      className={`min-w-8 px-2 py-2 text-xs sm:min-w-0 sm:p-0 ${editOpen === m.material_id ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                    >
                      update
                    </button>
                    <button
                      onClick={() => toggleDefine(m)}
                      className={`min-w-8 px-2 py-2 text-xs sm:min-w-0 sm:p-0 ${defineOpen === m.material_id ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                    >
                      edit
                    </button>
                  </div>
                </div>

                {defineOpen === m.material_id && (
                  <div className="border-t border-veil/10 bg-veil/[0.04] px-5 py-3">
                    <p className="text-[13px] text-ink-2">
                      Fix the name, the amount or the unit. Your {m.completed} {m.unit} of progress
                      is kept.
                    </p>
                    <div className="mt-2.5 space-y-2">
                      <TextField
                        autoFocus
                        value={draft.name}
                        onValueChange={(v) => setDraft((d) => ({ ...d, name: v }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitDefine(m.material_id);
                          if (e.key === "Escape") setDefineOpen(null);
                        }}
                        placeholder="material name"
                        className="ob-glass w-full rounded-xl px-4 py-2 text-sm text-ink"
                      />
                      <div className="flex flex-wrap items-center gap-2.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="1"
                          value={draft.total}
                          onChange={(e) => setDraft((d) => ({ ...d, total: e.target.value }))}
                          placeholder="total"
                          className="ob-glass w-24 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                        />
                        <TextField
                          value={draft.unit}
                          onValueChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
                          placeholder="unit"
                          className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-ink"
                        />
                        <button
                          onClick={() => submitDefine(m.material_id)}
                          disabled={
                            busy ||
                            !draft.name.trim() ||
                            !draft.unit.trim() ||
                            !(Number(draft.total) > 0)
                          }
                          className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setDefineOpen(null)}
                          className="text-xs text-ink-muted hover:text-ink"
                        >
                          cancel
                        </button>
                        {removeArmed === m.material_id ? (
                          <span className="ml-auto flex items-center gap-2.5">
                            <span className="text-xs text-ink-2">Remove for good?</span>
                            <button
                              onClick={() => removeMaterial(m.material_id)}
                              disabled={busy}
                              className="text-xs font-semibold text-bad hover:text-bad disabled:opacity-40"
                            >
                              yes, remove
                            </button>
                            <button
                              onClick={() => setRemoveArmed(null)}
                              className="text-xs text-ink-muted hover:text-ink"
                            >
                              keep
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setRemoveArmed(m.material_id)}
                            className="ml-auto text-xs text-ink-muted hover:text-bad"
                          >
                            remove material
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        Changing the amount or the unit re-plans the remaining days. Work you
                        already logged stays.
                      </p>
                    </div>
                  </div>
                )}
                {editOpen === m.material_id && (
                  <div className="border-t border-veil/10 bg-veil/[0.04] px-5 py-3">
                    <p className="text-[13px] text-ink-2">
                      Where are you in &quot;{m.name}&quot;? Completed {m.unit} of {m.total}:
                    </p>
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={m.total}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitEdit(m.material_id);
                          if (e.key === "Escape") setEditOpen(null);
                        }}
                        className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                      />
                      <button
                        onClick={() => submitEdit(m.material_id)}
                        disabled={busy || editValue.trim() === "" || Number(editValue) < 0 || Number.isNaN(Number(editValue))}
                        className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditOpen(null)} className="text-xs text-ink-muted hover:text-ink">
                        cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {plan.materials.length === 0 && (
              <li>
                <EmptyState
                  title="No materials yet"
                  body="Materials are the real work behind this mission — a book, a paper stack, a set of mock exams. Add one and the daily plan builds itself."
                  action={
                    <button
                      onClick={() => setAddOpen(true)}
                      className="ob-btn rounded-xl px-5 py-2.5 text-sm font-semibold"
                    >
                      Add the first material
                    </button>
                  }
                />
              </li>
            )}
          </ul>

          {addOpen ? (
            <div className="ob-glass mt-2.5 space-y-2 rounded-2xl px-5 py-4">
              <p className="text-[13px] text-ink-2">New material for this mission:</p>
              <TextField
                autoFocus
                value={addDraft.name}
                onValueChange={(v) => setAddDraft((d) => ({ ...d, name: v }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdd();
                  if (e.key === "Escape") setAddOpen(false);
                }}
                placeholder="book, PDF or exam collection"
                className="ob-glass w-full rounded-xl px-4 py-2 text-sm text-ink"
              />
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={addDraft.total}
                  onChange={(e) => setAddDraft((d) => ({ ...d, total: e.target.value }))}
                  placeholder="total"
                  className="ob-glass w-24 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                />
                <TextField
                  value={addDraft.unit}
                  onValueChange={(v) => setAddDraft((d) => ({ ...d, unit: v }))}
                  placeholder="unit"
                  className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-ink"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={addDraft.done}
                  onChange={(e) => setAddDraft((d) => ({ ...d, done: e.target.value }))}
                  placeholder="done"
                  className="ob-glass w-24 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                />
                <button
                  onClick={submitAdd}
                  disabled={busy || !addDraft.name.trim() || !(Number(addDraft.total) > 0)}
                  className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                >
                  Add
                </button>
                <button onClick={() => setAddOpen(false)} className="text-xs text-ink-muted hover:text-ink">
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              className="mt-1 py-2.5 text-sm text-ink-2 hover:text-ink"
            >
              + add material
            </button>
          )}

          {actionError && <p className="mt-3 text-sm text-bad">✕ {actionError}</p>}
        </section>

        <section className="mt-12">
          <div className="flex gap-2">
            <TabButton active={tab === "schedule"} onClick={() => setTab("schedule")}>
              Next 14 days
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              History
            </TabButton>
          </div>

          {tab === "schedule" ? (
            <ScheduleList tasks={schedule} />
          ) : (
            <div className="mt-4">
              <DataTable
                rows={history}
                getKey={(t) => `${t.date}:${t.material_id ?? "x"}`}
                empty={
                  <EmptyState
                    title="No history yet"
                    body="Days appear here once they are behind you — finished and missed alike, because both are the honest record."
                  />
                }
                columns={[
                  {
                    key: "date",
                    header: "Day",
                    width: "8.5rem",
                    render: (t) => <span className="text-xs text-ink-muted tnum">{t.date}</span>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    width: "6.5rem",
                    // Icon + word, never colour alone.
                    render: (t) => (
                      <span className={`text-xs font-semibold ${t.completed ? "text-good" : "text-bad"}`}>
                        <span aria-hidden>{t.completed ? "✓" : "✕"}</span>{" "}
                        {t.completed ? "Done" : "Missed"}
                      </span>
                    ),
                  },
                  {
                    key: "task",
                    header: "Task",
                    render: (t) => (
                      <span className={t.completed ? "text-ink" : "text-ink-muted"}>{t.description}</span>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </section>

        <div className="mt-14 border-t border-veil/10 pt-5">
          {confirmDelete ? (
            <div className="ob-glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
              <p className="text-sm text-ink">
                Delete <span className="font-semibold">&quot;{plan.goal.title}&quot;</span> and all its data?
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={deleteMission}
                  disabled={busy}
                  className="rounded-xl border border-bad/40 bg-bad/10 px-5 py-2 text-xs font-semibold text-bad transition-colors hover:bg-bad/20 disabled:opacity-50"
                >
                  {busy ? "…" : "Delete forever"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="py-2.5 text-xs text-ink-muted hover:text-ink">
                  keep it
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="py-2.5 text-xs text-ink-muted hover:text-bad">
              Delete mission
            </button>
          )}
        </div>
      </div>
    </DarkShell>
  );
}



function ScheduleList({ tasks }: { tasks: ScheduledTask[] }) {
  const byDate = new Map<string, ScheduledTask[]>();
  for (const t of tasks) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }
  if (byDate.size === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="Nothing scheduled yet"
          body="Add a material above and the plan fills itself in from today to the deadline."
        />
      </div>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-4 space-y-2">
      {[...byDate.entries()].map(([date, dayTasks]) => (
        <div key={date} className="flex gap-3 px-2 py-1.5">
          <span
            className={`w-24 shrink-0 text-xs tnum ${date === today ? "font-semibold text-ink" : "text-ink-muted"}`}
          >
            {date === today
              ? "TODAY"
              : new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
          </span>
          <div className="flex-1 space-y-0.5">
            {dayTasks.map((t) => (
              <p key={`${t.date}:${t.material_id ?? "x"}`} className={`text-sm ${t.completed ? "text-ink-muted line-through" : "text-ink-2"}`}>
                {t.description}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
