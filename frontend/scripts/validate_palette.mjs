/**
 * Categorical chart palette check.
 *
 * `globals.css` has long carried a comment telling you to run
 * `scripts/validate_palette.js` before touching --chart-*. That file was never
 * in the repo, so the instruction could not be followed. This is it.
 *
 * Four gates, all of which a brand-derived ramp typically fails:
 *   1. Contrast >= 3:1 against the card surface, so a slice or line is visible.
 *   2. Lightness band — no slot so much darker/lighter that it reads as
 *      "emphasised" rather than "different".
 *   3. Chroma floor, so nothing degrades into grey.
 *   4. Separation >= 15 dE between every pair, in normal vision AND under
 *      deuteranopia — the failure mode where two categories become one.
 *
 *   node scripts/validate_palette.mjs
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
const contrast = (a, b) => {
  const [hi, lo] = L(a) > L(b) ? [L(a), L(b)] : [L(b), L(a)];
  return (hi + 0.05) / (lo + 0.05);
};

function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const chroma = (rgb) => Math.hypot(lab(rgb)[1], lab(rgb)[2]);

/** Brettel-style deuteranope simulation, good enough to catch collisions. */
function deuter(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sim = [
    0.625 * r + 0.375 * g + 0.0 * b,
    0.7 * r + 0.3 * g + 0.0 * b,
    0.0 * r + 0.3 * g + 0.7 * b,
  ];
  void l;
  const unlin = (c) =>
    Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  return sim.map((c) => Math.max(0, Math.min(255, unlin(c))));
}

const THEMES = {
  light: {
    surface: "#ffffff",
    ramp: ["#c2185b", "#0072b2", "#0f7b6c", "#6d3ac7"],
    band: [30, 62],
  },
  dark: {
    surface: "#241a2c",
    ramp: ["#ff8fb1", "#5aa9e6", "#5fd0a8", "#cfa8ff"],
    band: [62, 82],
  },
};

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok " : " FAIL"} ${label}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
};

for (const [name, { surface, ramp, band }] of Object.entries(THEMES)) {
  console.log(`\n=== ${name} — categorical ramp on ${surface} ===`);
  const rgb = ramp.map(hex);

  ramp.forEach((h, i) => {
    const c = contrast(rgb[i], hex(surface));
    check(`chart-${i + 1} ${h} contrast ${c.toFixed(2)}:1 >= 3`, c >= 3, c.toFixed(2));
  });
  ramp.forEach((h, i) => {
    const l = lab(rgb[i])[0];
    check(
      `chart-${i + 1} ${h} lightness ${l.toFixed(0)} in ${band[0]}-${band[1]}`,
      l >= band[0] && l <= band[1],
      l.toFixed(0)
    );
  });
  ramp.forEach((h, i) => {
    const c = chroma(rgb[i]);
    check(`chart-${i + 1} ${h} chroma ${c.toFixed(0)} >= 25`, c >= 25, c.toFixed(0));
  });
  for (let i = 0; i < rgb.length; i++) {
    for (let j = i + 1; j < rgb.length; j++) {
      const normal = dE(rgb[i], rgb[j]);
      const cvd = dE(deuter(rgb[i]), deuter(rgb[j]));
      check(
        `${ramp[i]} vs ${ramp[j]} — normal ${normal.toFixed(1)}, deutan ${cvd.toFixed(1)}`,
        normal >= 15 && cvd >= 15,
        `normal ${normal.toFixed(1)} / deutan ${cvd.toFixed(1)}`
      );
    }
  }
}

console.log();
if (failures) {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
