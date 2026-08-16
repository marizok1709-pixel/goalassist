"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api, ApiError, Feasibility, setToken } from "@/lib/api";
import { DarkNav, DayChip } from "@/components/darkchrome";
import { TextField } from "@/components/textfield";
import { RealityCheck } from "@/components/reality-check";
import { DAYS, STUDY_DAY_HOURS } from "@/components/ui";
import { analytics } from "@/lib/analytics";

// The conversational step machine. Register creates the account (token) up
// front; every later answer is held in local state until "building", which
// fires updateMe(availability) → createGoal → addMaterial(s).
//
// The "rhythm" step exists because the flow previously could not produce
// availability at all: the timing question was moved out to /timing behind a
// dashboard nudge, and the first real beta user never followed it. Their 26
// tasks landed on 13 consecutive days with no rest day — a plan nobody keeps.
// It asks only which days are rest days; hours stay refinable at /timing.
type Step =
  | "welcome"
  | "register"
  | "goal"
  | "deadline"
  | "materials"
  | "howfar"
  | "rhythm"
  | "reality"
  | "building"
  | "launch";

const STEP_ORDER: Step[] = [
  "welcome",
  "register",
  "goal",
  "deadline",
  "materials",
  "howfar",
  "rhythm",
  "reality",
  "building",
  "launch",
];

// Progress-dot order: dots span the five content questions only;
// welcome / register / building / launch sit outside the counter.
const COUNTED: Step[] = ["goal", "deadline", "materials", "howfar", "rhythm"];

// Directional page transition: content lifts + de-blurs into place over a
// persistent background, previous content lifts + blurs away first. Easing is
// a soft "ease-out-expo" that settles — the Apple-ish feel.
const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, y: 26 * dir, scale: 0.985, filter: "blur(10px)" }),
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
    // Drop the filter entirely once the step has settled. `blur(0px)` is not
    // `none`: it keeps the whole step in a composited layer, and Chromium on
    // Android then hands Gboard a wrong cursor anchor for inputs inside it —
    // committed words land at offset 0 and the field ends up word-reversed
    // ("Klara and Sun" → "sun and Klara", as the first beta user hit).
    transitionEnd: { filter: "none" },
  },
  exit: (dir: number) => ({
    opacity: 0,
    y: -26 * dir,
    scale: 0.985,
    filter: "blur(10px)",
    transition: { duration: 0.38, ease: [0.4, 0, 0.2, 1] as const },
  }),
};

interface MaterialDraft {
  id: number; // stable across re-renders so uncontrolled inputs keep their text
  name: string;
  amount: string; // total_quantity
  minutes: string; // minutes_per_unit, blank = no estimate yet
  unit: string;
  done: string; // already_completed
}

let draftSeq = 0;
const newMaterial = (): MaterialDraft => ({
  id: ++draftSeq,
  name: "",
  amount: "",
  unit: "pages",
  done: "",
  minutes: "",
});

interface Launched {
  title: string;
  days: number;
  remaining: { name: string; amount: number; unit: string }[];
}

/** Weekly availability in the shape the API stores: hours per weekday, 0 = rest. */
function availabilityFrom(restDays: Set<string>): Record<string, number> {
  return Object.fromEntries(DAYS.map((d) => [d.key, restDays.has(d.key) ? 0 : STUDY_DAY_HOURS]));
}

function daysFromToday(iso: string): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [dir, setDir] = useState(1);

  const [account, setAccount] = useState({ username: "", email: "", password: "" });
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [materials, setMaterials] = useState<MaterialDraft[]>(() => [newMaterial()]);
  // Rest days, by DAYS key. Everything is a study day until tapped off.
  const [restDays, setRestDays] = useState<Set<string>>(() => new Set());

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<Launched | null>(null);

  // Direction-aware navigation so transitions know forward vs. back.
  const stepRef = useRef<Step>(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  function navigate(to: Step) {
    analytics.track("onboarding_step", { step: to });
    setDir(STEP_ORDER.indexOf(to) >= STEP_ORDER.indexOf(stepRef.current) ? 1 : -1);
    setError("");
    setStep(to);
  }

  const namedMaterials = materials.filter((m) => m.name.trim() && Number(m.amount) > 0);

  // The verdict, and whether the student overrode it. Held in local state
  // because none of this exists on the server yet — that is the whole point of
  // asking before creating.
  const [feasibility, setFeasibility] = useState<Feasibility | null>(null);
  const [checking, setChecking] = useState(false);
  const [overCapacity, setOverCapacity] = useState(false);

  async function runRealityCheck() {
    setChecking(true);
    setError("");
    try {
      const result = await api.previewPlan({
        title: title.trim(),
        deadline,
        materials: namedMaterials.map((m) => ({
          name: m.name.trim(),
          total_quantity: Number(m.amount),
          unit: m.unit.trim() || "units",
          already_completed: Number(m.done) || 0,
          minutes_per_unit: Number(m.minutes) || null,
        })),
        availability: availabilityFrom(restDays),
      });
      setFeasibility(result);
      navigate("reality");
    } catch (err) {
      // A verdict we cannot fetch must not block the mission. Fall through to
      // creation rather than stranding the student on a dead step.
      setError(err instanceof ApiError ? err.message : "");
      navigate("building");
    } finally {
      setChecking(false);
    }
  }

  // ----- account -----
  async function register() {
    if (!account.username.trim() || !account.email.trim() || account.password.length < 8) {
      setError("Fill every field — password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.register({
        name: account.username.trim(),
        email: account.email.trim(),
        password: account.password,
      });
      setToken(res.access_token);
      navigate("goal");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  // ----- build everything once all answers are collected -----
  useEffect(() => {
    if (step !== "building") return;
    let cancelled = false;
    (async () => {
      setError("");
      try {
        // Availability first, deliberately. The user has no goals yet, so
        // PATCH /auth/me's reschedule loop is a no-op here — and the first
        // schedule, built by addMaterial below, is then already weighted
        // correctly instead of being built wrong and immediately rebuilt.
        await api.updateMe({ availability: availabilityFrom(restDays) });
        analytics.track("availability_saved", { from: "onboarding", rest_days: restDays.size });
        const goal = await api.createGoal({
          title: title.trim(),
          deadline,
          launched_over_capacity: overCapacity,
        });
        const remaining: Launched["remaining"] = [];
        for (const m of namedMaterials) {
          const total = Number(m.amount);
          const done = Number(m.done) || 0;
          await api.addMaterial(goal.id, {
            name: m.name.trim(),
            total_quantity: total,
            unit: m.unit.trim() || "units",
            already_completed: done,
            minutes_per_unit: Number(m.minutes) || undefined,
          });
          remaining.push({ name: m.name.trim(), amount: Math.max(total - done, 0), unit: m.unit.trim() || "units" });
        }
        if (cancelled) return;
        // Let the loading bar breathe before the reveal.
        await new Promise((r) => setTimeout(r, 900));
        if (cancelled) return;
        analytics.track("mission_created", {
          materials: namedMaterials.length,
          days_to_deadline: Math.max(daysFromToday(deadline) ?? 0, 0),
          from: "onboarding",
        });
        analytics.track("onboarding_complete");
        setLaunched({ title: title.trim(), days: Math.max(daysFromToday(deadline) ?? 0, 0), remaining });
        navigate("launch");
      } catch (err) {
        if (cancelled) return;
        // navigate() clears error, so set it *after* returning to the step.
        navigate("rhythm");
        setError(err instanceof ApiError ? err.message : "Cannot reach the server");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const dLeft = daysFromToday(deadline);
  const studyDays = DAYS.length - restDays.size;

  return (
    <MotionConfig reducedMotion="user">
      <div className="ob-root">
        <DarkNav />

        <AnimatePresence>
          {step !== "welcome" && step !== "launch" && step !== "building" && (
            <motion.div
              key="dots"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ProgressDots step={step} />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="mx-auto flex min-h-[calc(100vh-4.5rem)] max-w-3xl flex-col items-center justify-center px-5 py-10 text-center sm:px-6 sm:py-16">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex w-full flex-col items-center"
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );

  function renderStep() {
    switch (step) {
      case "welcome":
        return (
          <>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl md:text-7xl">Goal Assist</h1>
            <p className="mt-6 text-lg font-semibold text-ink sm:text-xl">
              Turn long-term deadlines into daily certainty.
            </p>
            <p className="mt-2 text-base text-ink-2 sm:text-lg">
              Prepare for exams, applications, and goals
              <br className="hidden sm:block" /> without wondering what to do next.
            </p>
            <button className="ob-btn mt-10 rounded-2xl px-8 py-4 text-lg font-semibold" onClick={() => navigate("register")}>
              Create your first mission
            </button>
            <p className="mt-6 text-sm text-ink-muted">
              Already have an account?{" "}
              <Link href="/login" className="inline-block py-2 text-ink underline hover:text-ink">
                Sign in
              </Link>
            </p>
            {error && <ErrorLine msg={error} />}
          </>
        );

      case "register":
        return (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">Register</h1>
            <div className="mt-10 w-full max-w-md space-y-4">
              <TextField
                className="ob-glass w-full rounded-2xl px-5 py-4 text-base text-ink sm:px-6 sm:py-5 sm:text-lg"
                placeholder="username"
                value={account.username}
                onValueChange={(v) => setAccount({ ...account, username: v })}
              />
              <input
                className="ob-glass w-full rounded-2xl px-5 py-4 text-base text-ink sm:px-6 sm:py-5 sm:text-lg"
                type="email"
                placeholder="email"
                value={account.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
              />
              <input
                className="ob-glass w-full rounded-2xl px-5 py-4 text-base text-ink sm:px-6 sm:py-5 sm:text-lg"
                type="password"
                placeholder="password (min 8 characters)"
                value={account.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && register()}
              />
            </div>
            {error && <ErrorLine msg={error} />}
            <StepButtons onBack={() => navigate("welcome")} onNext={register} busy={busy} label={busy ? "Creating…" : "Create account →"} />
          </>
        );

      case "goal":
        return (
          <>
            <p className="text-xl font-semibold text-ink sm:text-2xl">Let&apos;s get started</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">What do you want to achieve?</h1>
            <TextField
              autoFocus
              className="ob-glass mt-10 w-full max-w-xl rounded-full px-5 py-4 text-center text-base text-ink sm:px-8 sm:py-5 sm:text-lg"
              placeholder="type your goal title here"
              value={title}
              onValueChange={setTitle}
              onKeyDown={(e) => e.key === "Enter" && title.trim() && navigate("deadline")}
            />
            <StepButtons
              onBack={() => navigate("register")}
              onNext={() => title.trim() && navigate("deadline")}
              disabled={!title.trim()}
            />
          </>
        );

      case "deadline":
        return (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">When is the deadline for this goal?</h1>
            <input
              autoFocus
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              className="ob-glass ob-date mt-10 w-full max-w-md rounded-full px-5 py-4 text-center text-base text-ink sm:px-8 sm:py-5 sm:text-lg"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <p className="mt-5 text-lg font-semibold text-ink">
              {dLeft === null
                ? " "
                : dLeft < 0
                  ? "that date is already past"
                  : `which is ${dLeft} ${dLeft === 1 ? "day" : "days"} from now`}
            </p>
            <StepButtons
              onBack={() => navigate("goal")}
              onNext={() => dLeft !== null && dLeft >= 0 && navigate("materials")}
              disabled={dLeft === null || dLeft < 0}
            />
          </>
        );

      case "materials":
        return (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">What materials will get you there?</h1>
            <p className="mt-3 text-base text-ink-2 sm:text-lg">The real work: books, mock exams, vocab sets.</p>
            <div className="mt-10 w-full max-w-xl space-y-6">
              {materials.map((m, i) => (
                <div key={m.id} className="space-y-3">
                  <TextField
                    className="ob-glass w-full rounded-full px-5 py-4 text-center text-base text-ink sm:px-8 sm:py-5 sm:text-lg"
                    placeholder="book, PDF or exam collection"
                    value={m.name}
                    onValueChange={(v) => setMat(i, "name", v)}
                  />
                  <div className="flex gap-3">
                    <input
                      className="ob-glass w-1/2 rounded-full px-3 py-4 text-center text-base text-ink sm:px-6 sm:text-lg"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      placeholder="how much"
                      value={m.amount}
                      onChange={(e) => setMat(i, "amount", e.target.value)}
                    />
                    <TextField
                      className="ob-glass w-1/2 rounded-full px-3 py-4 text-center text-base text-ink sm:px-6 sm:text-lg"
                      placeholder="pages, papers, units…"
                      value={m.unit}
                      onValueChange={(v) => setMat(i, "unit", v)}
                    />
                  </div>
                  {materials.length > 1 && (
                    <button
                      className="text-sm text-ink-muted hover:text-ink"
                      onClick={() => setMaterials(materials.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              className="mt-5 text-base text-ink-2 hover:text-ink"
              onClick={() => setMaterials([...materials, newMaterial()])}
            >
              + add another material
            </button>
            <StepButtons
              onBack={() => navigate("deadline")}
              onNext={() => namedMaterials.length > 0 && navigate("howfar")}
              disabled={namedMaterials.length === 0}
            />
          </>
        );

      case "howfar":
        return (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">How far are you already?</h1>
            <p className="mt-3 text-base text-ink-2 sm:text-lg">Where you stand today. Leave 0 if you&apos;re just starting.</p>
            <div className="mt-10 w-full max-w-xl space-y-5">
              {namedMaterials.map((m) => {
                const idx = materials.indexOf(m);
                return (
                  <div key={m.id} className="text-left">
                    <p className="mb-2 pl-2 text-base text-ink-2">
                      {m.name} — <span className="text-ink-muted">of {m.amount} {m.unit}</span>
                    </p>
                    <input
                      className="ob-glass w-full rounded-full px-5 py-4 text-center text-base text-ink sm:px-8 sm:text-lg"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={m.amount || undefined}
                      placeholder={`${m.unit} done so far`}
                      value={m.done}
                      onChange={(e) => setMat(idx, "done", e.target.value)}
                    />
                    {/* Optional. Skipping it is a real answer: without minutes
                        the plan states a required rate instead of a finish
                        date, which is honest rather than broken. Asking here
                        rather than on its own step keeps the flow at five
                        questions. */}
                    <input
                      className="ob-glass mt-2 w-full rounded-full px-5 py-3 text-center text-sm text-ink sm:px-8"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder={`minutes per ${m.unit.replace(/s$/, "") || "unit"} (optional)`}
                      value={m.minutes}
                      onChange={(e) => setMat(idx, "minutes", e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
            {error && <ErrorLine msg={error} />}
            <StepButtons onBack={() => navigate("materials")} onNext={() => navigate("rhythm")} />
          </>
        );

      case "rhythm":
        return (
          <>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Which days do you not study?
            </h1>
            <p className="mt-3 text-base text-ink-2 sm:text-lg">
              Tap them off. Nothing gets scheduled on a rest day.
            </p>
            <div className="mt-10 flex w-full max-w-xl flex-wrap justify-center gap-3">
              {DAYS.map((d) => (
                <DayChip
                  key={d.key}
                  label={d.label}
                  on={!restDays.has(d.key)}
                  onToggle={() =>
                    setRestDays((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(d.key)) next.add(d.key);
                      return next;
                    })
                  }
                />
              ))}
            </div>
            <p className="mt-5 text-base text-ink-2 tnum">
              {studyDays === 0
                ? "Pick at least one day to study"
                : `${studyDays} study ${studyDays === 1 ? "day" : "days"} a week`}
            </p>
            <p className="mt-2 text-sm text-ink-muted">You can set real hours per day later.</p>
            {error && <ErrorLine msg={error} />}
            <StepButtons
              onBack={() => navigate("howfar")}
              onNext={() => studyDays > 0 && runRealityCheck()}
              disabled={studyDays === 0 || checking}
              label={checking ? "…" : "Check my plan →"}
            />
          </>
        );

      case "reality":
        if (!feasibility) return null;
        return (
          <RealityCheck
            result={feasibility}
            onBack={() => navigate("rhythm")}
            onContinue={(choice) => {
              // Only "start anyway" is a decision to record. The others change
              // an answer, so they send the student back to the question that
              // produced it — nothing has been written, so going back is free.
              if (choice.kind === "deadline") {
                setDeadline(choice.deadline);
                navigate("deadline");
              } else if (choice.kind === "scope") {
                navigate("materials");
              } else if (choice.kind === "hours") {
                navigate("rhythm");
              } else {
                setOverCapacity(feasibility.verdict === "OVER_CAPACITY");
                navigate("building");
              }
            }}
          />
        );

      case "building":
        return (
          <div className="ob-glass mx-auto flex w-full max-w-2xl items-center overflow-hidden rounded-full">
            <div className="ob-building-fill rounded-full py-5 pl-8 text-left text-xl font-semibold text-ink">
              loading
            </div>
          </div>
        );

      case "launch":
        if (!launched) return null;
        return (
          <>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-ink-2">✓ Mission created</p>
            <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">{launched.title}</h1>
            <motion.p
              className="mt-8 text-7xl font-bold tnum sm:mt-10 sm:text-8xl"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              {launched.days}
            </motion.p>
            <p className="text-lg text-ink-2">days to get there</p>
            {launched.remaining.length > 0 && (
              <div className="ob-glass mx-auto mt-8 w-full max-w-sm rounded-2xl p-5 text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-2">You&apos;ll need</p>
                <ul className="mt-3 space-y-1.5">
                  {launched.remaining.map((r) => (
                    <li key={r.name} className="flex justify-between text-ink">
                      <span className="truncate pr-3">{r.name}</span>
                      <span className="shrink-0 tnum">{r.amount} {r.unit}</span>
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
          </>
        );
    }
  }

  function setMat(i: number, field: keyof MaterialDraft, value: string) {
    setMaterials((prev) => prev.map((m, j) => (j === i ? { ...m, [field]: value } : m)));
  }
}

// ---------- small presentational pieces ----------

function ProgressDots({ step }: { step: Step }) {
  const idx = COUNTED.indexOf(step);
  return (
    <div className="flex justify-center gap-2 pt-2">
      {COUNTED.map((s, i) => (
        <motion.span
          key={s}
          animate={{ width: i === idx ? 24 : 6, opacity: i === idx ? 1 : 0.3 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="h-1.5 rounded-full bg-accent"
        />
      ))}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <p className="mt-5 text-base text-bad">✕ {msg}</p>;
}

function StepButtons({
  onBack,
  onNext,
  disabled,
  busy,
  label = "Continue →",
}: {
  onBack: () => void;
  onNext: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
}) {
  return (
    <div className="mt-10 flex items-center gap-4">
      <button className="text-base text-ink-muted hover:text-ink" onClick={onBack} disabled={busy}>
        ← back
      </button>
      <button
        className="ob-btn rounded-2xl px-8 py-3.5 text-base font-semibold"
        onClick={onNext}
        disabled={disabled || busy}
      >
        {label}
      </button>
    </div>
  );
}
