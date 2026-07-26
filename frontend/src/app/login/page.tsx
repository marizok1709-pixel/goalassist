"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";
import { btnPrimary, ErrorNote, inputCls } from "@/components/ui";

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="font-mono text-lg tracking-widest text-ink">SIGN IN</h1>
      <p className="mt-1 text-sm text-ink-muted">Resume your missions.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          className={inputCls}
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <ErrorNote message={error} />}
        <button className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        No account?{" "}
        <Link href="/onboarding" className="text-accent hover:underline">
          Register
        </Link>
      </p>
    </div>
  );
}
