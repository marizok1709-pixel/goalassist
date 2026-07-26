"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api, ApiError, setToken } from "@/lib/api";

// Weekly availability keys the backend expects (hours per weekday, 0 = rest).
const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

// The conversational step machine. Register creates the account (token) up
// front; every later answer is held in local state until "building", which
// fires createGoal → addMaterial(s) → updateMe(availability) in one shot.
type Step =
  | "welcome"
  | "register"
  | "goal"
  | "deadline"
  | "materials"
  | "howfar"
  | "availability"
  | "building"
  | "launch";

const STEP_ORDER: Step[] = [
  "welcome",
  "register",
  "goal",
  "deadline",
  "materials",
  "howfar",
  "availability",
  "building",
  "launch",
];

// Progress-dot order (approved: dots span the five content questions only;
// welcome / register / building / launch sit outside the counter).
const COUNTED: Step[] = ["goal", "deadline", "materials", "howfar", "availability"];

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
  name: string;
  amount: string; // total_quantity
  unit: string;
  done: string; // already_completed
}

const emptyMaterial: MaterialDraft = { name: "", amount: "", unit: "pages", done: "" };

interface Launched {
  title: string;
  days: number;
  remaining: { name: string; amount: number; unit: string }[];
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
  const [materials, setMaterials] = useState<MaterialDraft[]>([{ ...emptyMaterial }]);
  const [avail, setAvail] = useState<Record<string, number>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, 0]))
  );

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<Launched | null>(null);

  // Direction-aware navigation so transitions know forward vs. back.
  const stepRef = useRef<Step>(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  function navigate(to: Step) {
    setDir(STEP_ORDER.indexOf(to) >= STEP_ORDER.indexOf(stepRef.current) ? 1 : -1);
    setError("");
    setStep(to);
  }

  const namedMaterials = materials.filter((m) => m.name.trim() && Number(m.amount) > 0);

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
        const goal = await api.createGoal({ title: title.trim(), deadline });
        const remaining: Launched["remaining"] = [];
        for (const m of namedMaterials) {
          const total = Number(m.amount);
          const done = Number(m.done) || 0;
          await api.addMaterial(goal.id, {
            name: m.name.trim(),
            total_quantity: total,
            unit: m.unit.trim() || "units",
            already_completed: done,
          });
          remaining.push({ name: m.name.trim(), amount: Math.max(total - done, 0), unit: m.unit.trim() || "units" });
        }
        await api.updateMe({ availability: avail });
        if (cancelled) return;
        // Let the loading bar breathe before the reveal.
        await new Promise((r) => setTimeout(r, 900));
        if (cancelled) return;
        setLaunched({ title: title.trim(), days: Math.max(daysFromToday(deadline) ?? 0, 0), remaining });
        navigate("launch");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Cannot reach the server");
        navigate("availability");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const dLeft = daysFromToday(deadline);
  const totalHours = DAYS.reduce((s, d) => s + (avail[d.key] || 0), 0);

  return (
    <MotionConfig reducedMotion="user">
      <div className="ob-root">
        <TopBar />

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

        <main className="mx-auto flex min-h-[calc(100vh-4.5rem)] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
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
            <h1 className="text-6xl font-bold tracking-tight sm:text-7xl">Goal Assist</h1>
            <p className="mt-6 text-xl font-semibold text-white/90">
              Turn long-term deadlines into daily certainty.
            </p>
            <p className="mt-2 text-lg text-white/70">
              Prepare for exams, applications, and goals
              <br className="hidden sm:block" /> without wondering what to do next.
            </p>
            <button className="ob-btn mt-12 rounded-2xl px-8 py-4 text-lg font-semibold" onClick={() => navigate("register")}>
              Create your first mission
            </button>
            <p className="mt-6 text-sm text-white/50">
              Already have an account?{" "}
              <Link href="/login" className="text-white/80 underline hover:text-white">
                Sign in
              </Link>
            </p>
          </>
        );

      case "register":
        return (
          <>
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Register</h1>
            <div className="mt-10 w-full max-w-md space-y-4">
              <input
                className="ob-glass w-full rounded-2xl px-6 py-5 text-lg text-white"
                placeholder="username"
                value={account.username}
                onChange={(e) => setAccount({ ...account, username: e.target.value })}
              />
              <input
                className="ob-glass w-full rounded-2xl px-6 py-5 text-lg text-white"
                type="email"
                placeholder="email"
                value={account.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
              />
              <input
                className="ob-glass w-full rounded-2xl px-6 py-5 text-lg text-white"
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
            <p className="text-2xl font-semibold text-white/80">Let&apos;s get started</p>
            <h1 className="mt-1 text-5xl font-bold tracking-tight sm:text-6xl">What do you want to achieve?</h1>
            <input
              autoFocus
              className="ob-glass mt-10 w-full max-w-xl rounded-full px-8 py-5 text-center text-lg text-white"
              placeholder="type your goal title here"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">When is the deadline for this goal?</h1>
            <input
              autoFocus
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              className="ob-glass ob-date mt-10 w-full max-w-md rounded-full px-8 py-5 text-center text-lg text-white"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <p className="mt-5 text-lg font-semibold text-white/80">
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
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">What materials will get you there?</h1>
            <p className="mt-3 text-lg text-white/60">The real work: books, mock exams, vocab sets.</p>
            <div className="mt-10 w-full max-w-xl space-y-6">
              {materials.map((m, i) => (
                <div key={i} className="space-y-3">
                  <input
                    className="ob-glass w-full rounded-full px-8 py-5 text-center text-lg text-white"
                    placeholder="book, PDF or exam collection"
                    value={m.name}
                    onChange={(e) => setMat(i, "name", e.target.value)}
                  />
                  <div className="flex gap-3">
                    <input
                      className="ob-glass w-1/2 rounded-full px-6 py-4 text-center text-lg text-white"
                      type="number"
                      min="1"
                      placeholder="how much"
                      value={m.amount}
                      onChange={(e) => setMat(i, "amount", e.target.value)}
                    />
                    <input
                      className="ob-glass w-1/2 rounded-full px-6 py-4 text-center text-lg text-white"
                      placeholder="pages, papers, units…"
                      value={m.unit}
                      onChange={(e) => setMat(i, "unit", e.target.value)}
                    />
                  </div>
                  {materials.length > 1 && (
                    <button
                      className="text-sm text-white/50 hover:text-white/80"
                      onClick={() => setMaterials(materials.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              className="mt-5 text-base text-white/60 hover:text-white/90"
              onClick={() => setMaterials([...materials, { ...emptyMaterial }])}
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
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">How far are you already?</h1>
            <p className="mt-3 text-lg text-white/60">Where you stand today. Leave 0 if you&apos;re just starting.</p>
            <div className="mt-10 w-full max-w-xl space-y-5">
              {namedMaterials.map((m) => {
                const idx = materials.indexOf(m);
                return (
                  <div key={idx} className="text-left">
                    <p className="mb-2 pl-2 text-base text-white/70">
                      {m.name} — <span className="text-white/50">of {m.amount} {m.unit}</span>
                    </p>
                    <input
                      className="ob-glass w-full rounded-full px-8 py-4 text-center text-lg text-white"
                      type="number"
                      min="0"
                      max={m.amount || undefined}
                      placeholder={`${m.unit} done so far`}
                      value={m.done}
                      onChange={(e) => setMat(idx, "done", e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
            <StepButtons onBack={() => navigate("materials")} onNext={() => navigate("availability")} />
          </>
        );

      case "availability":
        return (
          <>
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Let&apos;s talk about timing</h1>
            <p className="mt-3 text-lg text-white/60">Study hours per day. 0 means a rest day — no tasks land there.</p>
            <div className="mt-10 grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {DAYS.map((d) => (
                <DayColumn
                  key={d.key}
                  label={d.label}
                  hours={avail[d.key]}
                  onStep={(delta) =>
                    setAvail((prev) => ({
                      ...prev,
                      [d.key]: Math.min(Math.max((prev[d.key] || 0) + delta, 0), 16),
                    }))
                  }
                />
              ))}
            </div>
            <p className="mt-5 text-base text-white/60 tnum">{totalHours} h / week</p>
            {error && <ErrorLine msg={error} />}
            <StepButtons
              onBack={() => navigate("howfar")}
              onNext={() => totalHours > 0 && navigate("building")}
              disabled={totalHours === 0}
              label="Build my plan →"
            />
            {totalHours === 0 && (
              <p className="mt-2 text-sm text-white/50">Give at least one day some hours — the work has to land somewhere.</p>
            )}
          </>
        );

      case "building":
        return (
          <div className="ob-glass mx-auto flex w-full max-w-2xl items-center overflow-hidden rounded-full">
            <div className="ob-building-fill rounded-full py-5 pl-8 text-left text-xl font-semibold text-white">
              loading
            </div>
          </div>
        );

      case "launch":
        if (!launched) return null;
        return (
          <>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">✓ Mission created</p>
            <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-6xl">{launched.title}</h1>
            <motion.p
              className="mt-10 text-8xl font-bold tnum"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              {launched.days}
            </motion.p>
            <p className="text-lg text-white/70">days to get there</p>
            {launched.remaining.length > 0 && (
              <div className="ob-glass mx-auto mt-8 w-full max-w-sm rounded-2xl p-5 text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">You&apos;ll need</p>
                <ul className="mt-3 space-y-1.5">
                  {launched.remaining.map((r) => (
                    <li key={r.name} className="flex justify-between text-white/85">
                      <span className="truncate pr-3">{r.name}</span>
                      <span className="shrink-0 tnum">{r.amount} {r.unit}</span>
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
          </>
        );
    }
  }

  function setMat(i: number, field: keyof MaterialDraft, value: string) {
    setMaterials((prev) => prev.map((m, j) => (j === i ? { ...m, [field]: value } : m)));
  }
}

// ---------- small presentational pieces ----------

function TopBar() {
  // Marketing nav from the design; routes don't exist yet, so these are inert
  // placeholders (plus a light-mode toggle placeholder) — flagged for later.
  const items = ["policies and data", "settings", "social media", "support", "about us"];
  return (
    <div className="flex items-center justify-between px-8 py-6 text-sm font-medium text-white/85">
      <div className="flex flex-wrap gap-6">
        {items.map((i) => (
          <span key={i} className="cursor-default">{i}</span>
        ))}
      </div>
      <span className="cursor-default">light mode</span>
    </div>
  );
}

function ProgressDots({ step }: { step: Step }) {
  const idx = COUNTED.indexOf(step);
  return (
    <div className="flex justify-center gap-2 pt-2">
      {COUNTED.map((s, i) => (
        <motion.span
          key={s}
          animate={{ width: i === idx ? 24 : 6, opacity: i === idx ? 1 : 0.3 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="h-1.5 rounded-full bg-white"
        />
      ))}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <p className="mt-5 text-base text-red-300">✕ {msg}</p>;
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
    <div className="mt-12 flex items-center gap-4">
      <button className="text-base text-white/55 hover:text-white/85" onClick={onBack} disabled={busy}>
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

function DayColumn({
  label,
  hours,
  onStep,
}: {
  label: string;
  hours: number;
  onStep: (delta: number) => void;
}) {
  const active = hours > 0;
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={`ob-glass flex h-52 flex-col items-center rounded-3xl px-2 py-4 ${active ? "" : "opacity-60"}`}
    >
      <span className="text-sm font-semibold text-white">{label}</span>
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          className="ob-btn h-8 w-8 rounded-full text-lg leading-none"
          onClick={() => onStep(0.5)}
          aria-label={`Add time on ${label}`}
        >
          +
        </button>
        <motion.span key={hours} initial={{ scale: 1.25 }} animate={{ scale: 1 }} className="text-2xl font-bold tnum">
          {active ? hours : "—"}
        </motion.span>
        <span className="text-[11px] uppercase tracking-wide text-white/50">{active ? "hours" : "rest"}</span>
        <button
          className="ob-btn h-8 w-8 rounded-full text-lg leading-none disabled:opacity-30"
          onClick={() => onStep(-0.5)}
          disabled={!active}
          aria-label={`Remove time on ${label}`}
        >
          −
        </button>
      </div>
    </motion.div>
  );
}
