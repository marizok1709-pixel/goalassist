"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AdminUserRow } from "@/lib/api";
import { DataTable, ErrorLine, PageLoading, SectionLabel } from "@/components/ui";
import { TextField } from "@/components/textfield";

/**
 * Per-user roster for the admin dashboard.
 *
 * Shows individual PII (email, name, goal) — the dashboard's only view that
 * does. Beta-scoped with the testers' agreement, and only ever rendered behind
 * the is_admin gate the server enforces. Self-contained: it fetches its own
 * data and edits notes in place so a note save doesn't reload the whole board.
 */
export function AdminUsers() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .adminUsers()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load users"));
  }, []);

  async function saveNote(id: number) {
    setSaving(true);
    try {
      const updated = await api.setUserNote(id, draft.trim() || null);
      setRows((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
      setEditing(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  if (error && !rows) {
    return (
      <section className="mt-12">
        <SectionLabel>Users</SectionLabel>
        <ErrorLine msg={error} />
      </section>
    );
  }
  if (!rows) {
    return (
      <section className="mt-12">
        <SectionLabel>Users</SectionLabel>
        <PageLoading rows={2} />
      </section>
    );
  }

  return (
    <section className="mt-12">
      <SectionLabel>Users · {rows.length}</SectionLabel>
      <p className="mt-1 mb-3 text-xs text-ink-muted">
        Individual accounts. Visible to admins only; kept for the beta with the testers&apos;
        agreement. &ldquo;Working?&rdquo; is derived from completed tasks, so it reflects everyone
        regardless of analytics consent.
      </p>

      <div className="ob-glass rounded-2xl p-5">
        <DataTable
          rows={rows}
          getKey={(r) => r.id}
          columns={[
            {
              key: "user",
              header: "User",
              render: (r) => (
                <div>
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-xs text-ink-muted">{r.email}</p>
                  {r.is_admin && (
                    <span className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wide text-accent">
                      admin
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "goal",
              header: "Goal",
              render: (r) =>
                r.goals.length === 0 ? (
                  <span className="text-ink-muted">— none yet</span>
                ) : (
                  <div>
                    <p className="text-ink-2">{r.goals[0].title}</p>
                    {r.goals.length > 1 && (
                      <p className="text-xs text-ink-muted">+{r.goals.length - 1} more</p>
                    )}
                  </div>
                ),
            },
            {
              key: "working",
              header: "Working?",
              render: (r) => <ActivityCell row={r} />,
            },
            {
              key: "note",
              header: "Note",
              width: "16rem",
              render: (r) =>
                editing === r.id ? (
                  <div className="flex items-center gap-1.5">
                    <TextField
                      autoFocus
                      value={draft}
                      onValueChange={setDraft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveNote(r.id);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      placeholder="add a note…"
                      className="ob-glass w-full rounded-lg px-2.5 py-1 text-xs text-ink"
                    />
                    <button
                      onClick={() => saveNote(r.id)}
                      disabled={saving}
                      className="text-xs font-semibold text-accent disabled:opacity-40"
                    >
                      save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditing(r.id);
                      setDraft(r.note ?? "");
                    }}
                    className="group flex w-full items-start gap-1.5 text-left"
                  >
                    <span className={r.note ? "text-ink-2" : "text-ink-muted"}>
                      {r.note || "add a note"}
                    </span>
                    <span className="text-ink-muted opacity-0 transition-opacity group-hover:opacity-100">
                      ✎
                    </span>
                  </button>
                ),
            },
          ]}
        />
      </div>
      {error && <ErrorLine msg={error} />}
    </section>
  );
}

/** icon + label + counts, never colour alone. */
function ActivityCell({ row }: { row: AdminUserRow }) {
  let icon: string;
  let label: string;
  let cls: string;

  if (row.goals.length === 0) {
    icon = "○";
    label = "no mission";
    cls = "text-ink-muted";
  } else if (row.tasks_completed === 0) {
    icon = "◆";
    label = "signed up, idle";
    cls = "text-warn";
  } else {
    icon = "●";
    label = "active";
    cls = "text-good";
  }

  return (
    <div>
      <span className={`text-xs font-semibold ${cls}`}>
        <span aria-hidden>{icon}</span> {label}
      </span>
      {row.tasks_total > 0 && (
        <p className="text-xs text-ink-muted tnum">
          {row.tasks_completed}/{row.tasks_total} tasks
          {row.last_active ? ` · last ${shortDay(row.last_active)}` : ""}
        </p>
      )}
    </div>
  );
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
