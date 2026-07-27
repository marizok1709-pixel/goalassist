import { DarkShell } from "@/components/darkchrome";

export const metadata = { title: "About — Goal Assist" };

export default function AboutPage() {
  return (
    <DarkShell>
      <div className="pt-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">About Goal Assist</h1>
        <div className="mt-6 space-y-4 text-lg leading-relaxed text-white/70">
          <p>
            Goal Assist turns long-term academic deadlines into daily certainty. You give it a real
            goal, a hard deadline, and the actual material behind it — a textbook, a stack of mock
            exams, a vocabulary set. It slices the work, schedules it, and tells you, with plain
            arithmetic and no guesswork, whether your current pace will get you there — and exactly
            what to do today.
          </p>
          <p>
            No AI, no motivational fluff. The credibility comes from math you can check. It was built
            by a student, for students who are actually trying to make it.
          </p>
        </div>
      </div>
    </DarkShell>
  );
}
