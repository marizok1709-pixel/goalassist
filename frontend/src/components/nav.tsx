"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken } from "@/lib/api";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/", label: "Command Center" },
  { href: "/calendar", label: "Calendar" },
  { href: "/missions/new", label: "+ New Mission" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(getToken() !== null);
  }, [pathname]);

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="font-serif text-lg font-semibold tracking-tight text-ink">
          Goal<span className="text-accent">Assist</span>
        </Link>
        {authed && (
          <nav className="flex items-center gap-5 text-sm">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={
                  pathname === l.href
                    ? "font-medium text-accent"
                    : "text-ink-2 hover:text-ink transition-colors"
                }
              >
                {l.label}
              </Link>
            ))}
            <button onClick={logout} className="text-ink-muted hover:text-critical">
              Logout
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
