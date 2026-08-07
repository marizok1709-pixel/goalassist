/**
 * Text contrast for the "Bloom" / "Nocturne" themes.
 *
 * The direction is translucent panels over a saturated gradient, so contrast
 * is not a spot check on a flat swatch — every text token has to survive two
 * different backgrounds:
 *
 *   1. ON GLASS  — the film composited over the worst gradient stop. This is
 *      where most text lives (cards, fields, the tab bar).
 *   2. ON THE FIELD — headings, eyebrows and nav sit directly on the gradient
 *      with nothing behind them. This is the case that actually failed: at
 *      full strength the violet stop left --ink-muted at 2.93:1.
 *
 * The fix was two-sided and both halves are encoded here: the violet peak is
 * capped below full strength, and the lower two text steps were darkened. Keep
 * them in sync with globals.css.
 *
 *   node scripts/validate_contrast.mjs
 */

const hex = (h) => {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const L = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a, b) => {
  const [hi, lo] = L(a) > L(b) ? [L(a), L(b)] : [L(b), L(a)];
  return (hi + 0.05) / (lo + 0.05);
};
/** Composite `fg` at `alpha` over `bg`. */
const mix = (fg, alpha, bg) => hex(fg).map((c, i) => alpha * c + (1 - alpha) * hex(bg)[i]);
const toHex = (r) => "#" + r.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

const AA = 4.5;
let failures = 0;
const check = (label, r, need = AA) => {
  const ok = r >= need;
  console.log(`${ok ? "  ok " : " FAIL"} ${r.toFixed(2).padStart(5)}:1  ${label}`);
  if (!ok) failures++;
};

const THEMES = {
  "Bloom (light)": {
    bg: "#fff6f9",
    // stop, peak alpha — mirrors the --aurora layer list
    field: [
      ["#ff8fb1", 1.0],
      ["#c77dff", 0.82],
      ["#ffb3cd", 1.0],
    ],
    glassFilm: ["#ffffff", 0.68],
    text: { ink: "#1e1622", "ink-2": "#3c2934", "ink-muted": "#4e3444" },
    semantic: { accent: "#ab0f55", good: "#1b6344", warn: "#7d4708", bad: "#a81f19" },
    onFill: "#ffffff",
    fills: ["#c81e63", "#ab0f55", "#8e0b52"],
  },
  "Nocturne (dark)": {
    bg: "#120c17",
    field: [
      ["#42123a", 1.0],
      ["#221340", 1.0],
      ["#4e1638", 1.0],
    ],
    glassFilm: ["#ffffff", 0.12],
    text: { ink: "#fcf1f7", "ink-2": "#efcfe0", "ink-muted": "#cda9bc" },
    semantic: { accent: "#ffa6c8", good: "#7fdcaf", warn: "#f5c96b", bad: "#ffa697" },
    onFill: "#2a0e1c",
    fills: ["#ffc2da", "#ffa6c8", "#e97bb0"],
  },
};

for (const [name, t] of Object.entries(THEMES)) {
  console.log(`\n=== ${name} ===`);

  // The field as painted: each stop composited over the page ground at its peak.
  const painted = t.field.map(([stop, a]) => mix(stop, a, t.bg));
  painted.forEach((p, i) => console.log(`  field stop ${t.field[i][0]} @${t.field[i][1]} -> ${toHex(p)}`));

  // Glass over each painted stop; worst = the one that fights the text most.
  const glassed = painted.map((p) => hex(t.glassFilm[0]).map((c, i) => t.glassFilm[1] * c + (1 - t.glassFilm[1]) * p[i]));
  const light = L(hex(t.text.ink)) > 0.5;
  const pick = (arr) => arr.reduce((a, b) => ((light ? L(a) > L(b) : L(a) < L(b)) ? a : b));
  const worstGlass = pick(glassed);
  const worstField = pick(painted);
  console.log(`  worst glass: ${toHex(worstGlass)}   worst field: ${toHex(worstField)}\n`);

  for (const [k, v] of Object.entries({ ...t.text, ...t.semantic })) {
    check(`${k.padEnd(9)} ${v} on glass`, ratio(hex(v), worstGlass));
  }
  console.log();
  // Only the three text steps sit on the bare field; semantic colours are
  // always inside a card or a badge, never floating on the gradient.
  for (const [k, v] of Object.entries(t.text)) {
    check(`${k.padEnd(9)} ${v} on the bare field`, ratio(hex(v), worstField));
  }
  console.log();
  for (const f of t.fills) {
    check(`${t.onFill} on primary-button stop ${f}`, ratio(hex(t.onFill), hex(f)));
  }
}

console.log();
if (failures) {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
