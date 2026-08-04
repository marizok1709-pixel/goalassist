"use client";

import { useEffect } from "react";

/**
 * Drifts the halftone burst toward the pointer.
 *
 * Desktop-only by design. It requires all three of:
 *   - a fine pointer that can hover (excludes phones and tablets outright),
 *   - a viewport wide enough that the burst sits beside the content rather
 *     than under it — same 900px breakpoint that hides the texture in CSS,
 *   - no reduced-motion preference.
 *
 * Writes CSS custom properties straight onto <html>, so React never re-renders
 * while the mouse moves, and the rAF loop parks itself once the burst has
 * caught up — a permanently spinning loop is a real battery cost on a laptop,
 * which is the only place this runs.
 */
export function CursorTexture() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const wide = window.matchMedia("(min-width: 900px)");
    const stillness = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || !wide.matches || stillness.matches) return;

    const root = document.documentElement;
    // Percentages, seeded to the CSS defaults so the first move eases from rest.
    let curX = 6;
    let curY = 48;
    let tgtX = curX;
    let tgtY = curY;
    let frame = 0;
    let running = false;

    const tick = () => {
      const dx = tgtX - curX;
      const dy = tgtY - curY;
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        running = false; // settled — stop burning frames until the pointer moves
        return;
      }
      curX += dx * 0.07; // lag makes it drift rather than snap to the cursor
      curY += dy * 0.07;
      root.style.setProperty("--tex-x", `${curX.toFixed(2)}%`);
      root.style.setProperty("--tex-y", `${curY.toFixed(2)}%`);
      frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      tgtX = (e.clientX / window.innerWidth) * 100;
      tgtY = (e.clientY / window.innerHeight) * 100;
      if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      root.style.removeProperty("--tex-x");
      root.style.removeProperty("--tex-y");
    };
  }, []);

  return null;
}
