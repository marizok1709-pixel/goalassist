"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";
import { btnPrimary, ErrorNote, inputCls } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", university: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [field]: e.target.value });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.register({
        name: form.name,
        email: form.email,
        password: form.password,
        university: form.university || undefined,
      });
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
      <h1 className="font-mono text-lg tracking-widest text-ink">CREATE ACCOUNT</h1>
      <p className="mt-1 text-sm text-ink-muted">Start executing on your goals.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input className={inputCls} placeholder="name" value={form.name} onChange={set("name")} required />
        <input className={inputCls} type="email" placeholder="email" value={form.email} onChange={set("email")} required />
        <input
          className={inputCls}
          type="password"
          placeholder="password (min 8 characters)"
          value={form.password}
          onChange={set("password")}
          minLength={8}
          required
        />
        <input
          className={inputCls}
          placeholder="university (optional)"
          value={form.university}
          onChange={set("university")}
        />
        {error && <ErrorNote message={error} />}
        <button className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        Have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
