"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";
import { DarkNav } from "@/components/darkchrome";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.login(email, password);
      setToken(res.access_token);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cannot reach the server");
      setBusy(false);
    }
  }

  return (
    <div className="ob-root">
      <DarkNav />
      <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-white">Welcome back</h1>
        <p className="mt-3 text-lg text-white/60">Resume your missions.</p>
        <form onSubmit={submit} className="mt-10 w-full space-y-4">
          <input
            className="ob-glass w-full rounded-2xl px-6 py-5 text-lg text-white"
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="ob-glass w-full rounded-2xl px-6 py-5 text-lg text-white"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-base text-red-300">✕ {error}</p>}
          <button className="ob-btn w-full rounded-2xl px-8 py-4 text-lg font-semibold" disabled={busy}>
            {busy ? "…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-white/50">
          No account?{" "}
          <Link href="/onboarding" className="text-white/80 underline hover:text-white">
            Create your first mission
          </Link>
        </p>
      </main>
    </div>
  );
}
