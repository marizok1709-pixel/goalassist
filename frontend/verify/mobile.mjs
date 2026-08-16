/**
 * The regression lock for commit 5400900 ("Make the app usable on a phone").
 *
 * Two properties, on every route, in both themes:
 *
 *   1. Nothing overflows 360px horizontally. The calendar's hardcoded
 *      `grid-cols-7` is what made this a user-reported defect; a stray
 *      `min-w`, a long unbroken title or a fixed-width row brings it back and
 *      nobody notices on a laptop.
 *   2. Every control a thumb has to hit is big enough. The task checkbox was
 *      the expensive one — `accent-color` paints nothing until a box is
 *      checked, so on the dark theme it read as a disabled placeholder. The
 *      first beta user ticked 0 of 26 tasks on a phone.
 *
 * Run against a dev server; it registers a throwaway account each run and
 * never touches an existing one.
 */

import {
  BACKEND,
  FRONTEND,
  launch,
  phonePage,
  reporter,
  setTheme,
  onboard,
  waitForText,
  sleep,
} from "./lib.mjs";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_IDX = (new Date().getDay() + 6) % 7; // JS Sunday=0 → Monday=0
const REST_DAYS = [DAY_LABELS[(TODAY_IDX + 2) % 7], DAY_LABELS[(TODAY_IDX + 3) % 7]];


// The floors the mobile pass actually shipped: 32px for inline text controls,
// 44px for the two things the core loop depends on.
const FLOOR = 32;
const CRITICAL_FLOOR = 44;
const CRITICAL = ".ga-tabbar a, label:has(input.ga-check)";

/**
 * Measure every visible control on the page: big enough, then reachable.
 *
 * A checkbox is measured by its padded <label>, not by the box itself — the
 * label *is* the tap target, and that is the whole point of how it is built.
 *
 * Reachability is tested the way a user recovers from an overlay: scroll the
 * control to the middle of the screen, then see what is actually under the
 * point a thumb aims at. Anything a fixed bar merely happens to sit over at
 * the current scroll position is fine — the tab bar always overlaps *some*
 * content. What is not fine is a control that stays covered even when the page
 * has been scrolled to put it front and centre, which is what the consent
 * banner did to the onboarding CTA on a screen with no room to scroll.
 */
function measure(floor, criticalSelector, criticalFloor) {
  const seen = new Set();
  const bad = [];
  const selector = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    '[role="switch"]',
  ].join(", ");

  // Next's dev overlay injects its own fixed button; it does not ship.
  const isDevChrome = (el) =>
    Boolean(el.closest?.("nextjs-portal, [data-nextjs-dev-tools-button], #__next-build-watcher"));

  const targets = [];
  for (const el of document.querySelectorAll(selector)) {
    let target = el;
    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      target = el.closest("label") ?? el;
    }
    if (seen.has(target) || isDevChrome(target)) continue;
    seen.add(target);

    const style = getComputedStyle(target);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (Number(style.opacity) === 0) continue;
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const label = (target.innerText || target.getAttribute("aria-label") || target.placeholder || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    const name = `<${target.tagName.toLowerCase()}${label ? ` "${label}"` : ""}>`;

    const required = target.matches(criticalSelector) ? criticalFloor : floor;
    if (Math.min(r.width, r.height) + 0.5 < required) {
      bad.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)} < ${required}`);
      continue;
    }
    targets.push({ target, name });
  }

  for (const { target, name } of targets) {
    target.scrollIntoView({ block: "center", behavior: "instant" });
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || isDevChrome(hit)) continue;
    if (hit !== target && !target.contains(hit) && !hit.contains(target)) {
      const over = (hit.innerText || hit.getAttribute?.("aria-label") || hit.tagName)
        .toString()
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      bad.push(`${name} stays covered by <${hit.tagName.toLowerCase()} "${over}"> after scrolling`);
    }
  }
  return bad;
}

/**
 * Horizontal overflow, measured on the element that actually scrolls.
 *
 * Checking `documentElement` alone is not enough and is worse than useless —
 * it passes vacuously. `.ob-root` is the app's real scroll container and sets
 * `overflow-y: auto`, which per spec computes `overflow-x` to `auto` as well,
 * so a 520px child scrolls *inside it* and the document never widens at all.
 */
function overflow() {
  const containers = [document.documentElement, ...document.querySelectorAll(".ob-root")];
  for (const c of containers) {
    if (c.scrollWidth <= c.clientWidth + 1) continue;
    let worst = null;
    for (const el of c.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > c.clientWidth + 1 && (!worst || r.width > worst.width)) {
        worst = {
          width: r.width,
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 70),
        };
      }
    }
    return {
      ok: false,
      detail:
        `<${c.tagName.toLowerCase()}${c.className ? "." + String(c.className).split(" ")[0] : ""}> ` +
        `scrolls ${c.scrollWidth}px in ${c.clientWidth}px` +
        (worst ? ` — widest child <${worst.tag} class="${worst.cls}"> ${Math.round(worst.width)}px` : ""),
    };
  }
  return { ok: true, detail: "" };
}

const r = reporter("Mobile layout at 360×800 — overflow + tap targets");

const browser = await launch();
try {
  // One account, one mission, reused by every authed route below.
  const setup = await phonePage(browser);
  await onboard(setup, {
    title: "Verify the phone layout",
    days: 12,
    material: "Klara and the Sun",
    amount: 26,
    unit: "chapters",
    // Relative to today, never a fixed weekend: the checkbox check below needs
    // today to actually hold a task, and pinning these to Sat/Sun made the
    // suite fail every weekend for reasons that had nothing to do with the UI.
    restDays: REST_DAYS,
  });
  const token = await setup.evaluate(() => localStorage.getItem("acadassist_token"));
  r.check("onboarding completes on a phone", Boolean(token), "no token in localStorage");
  const missionId = await setup.evaluate(async (api) => {
    const res = await fetch(api + "/dashboard", {
      headers: { Authorization: "Bearer " + localStorage.getItem("acadassist_token") },
    });
    const data = await res.json();
    return data.goals?.[0]?.goal?.id ?? null;
  }, BACKEND);
  await setup.close();

  const routes = [
    "/onboarding",
    "/login",
    "/",
    "/today",
    "/calendar",
    "/timing",
    "/settings",
    "/missions/new",
    missionId ? `/missions/${missionId}` : null,
  ].filter(Boolean);
  r.check("mission id resolved for the detail route", missionId !== null, String(missionId));

  for (const theme of ["dark", "light"]) {
    const page = await phonePage(browser);
    await setTheme(page, theme);
    // Seed the session so authed routes render instead of redirecting, and
    // settle the consent question — the banner is a deliberate modal overlay
    // and every route below is checked in the state the app spends its life
    // in. The banner-open state gets its own checks at the end.
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => {
      localStorage.setItem("acadassist_token", t);
      localStorage.setItem("goalassist_consent", "denied");
    }, token);

    for (const route of routes) {
      await page.goto(FRONTEND + route, { waitUntil: "networkidle2" });
      // Let motion/react settle; a mid-flight transform can widen the page.
      await sleep(700);

      const o = await page.evaluate(overflow);
      r.check(`${theme} ${route} — no horizontal overflow`, o.ok, o.detail);

      const bad = await page.evaluate(measure, FLOOR, CRITICAL, CRITICAL_FLOOR);
      r.check(
        `${theme} ${route} — every control is tappable`,
        bad.length === 0,
        bad.join(" | ")
      );
    }
    await page.close();
  }

  // ---------------------------------------------------------- consent open
  //
  // The banner is fixed to the bottom of the viewport, which on a phone is
  // where the tab bar lives and where pages put their primary button. Content
  // can be scrolled out from under it; the tab bar cannot, so it must not be
  // covered at all — and the banner's own controls have to be tappable, since
  // nothing else works until one of them is pressed.
  {
    // A separate storage context: localStorage is shared across pages of one
    // browser, and every sweep above answered the consent question.
    const fresh = await browser.createBrowserContext();
    const page = await phonePage(fresh);
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => localStorage.setItem("acadassist_token", t), token);
    await page.goto(`${FRONTEND}/today`, { waitUntil: "networkidle2" });
    await sleep(900);

    const banner = await page.evaluate(() => {
      const el = document.querySelector(".ga-consent");
      if (!el) return null;
      const covered = [...document.querySelectorAll(".ga-tabbar a")].filter((a) => {
        const r = a.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !hit || (hit !== a && !a.contains(hit));
      });
      const small = [...el.querySelectorAll("a[href], button")].filter((c) => {
        const r = c.getBoundingClientRect();
        return Math.min(r.width, r.height) + 0.5 < 32;
      });
      return {
        coveredTabs: covered.map((a) => a.innerText.trim()),
        smallControls: small.map(
          (c) =>
            `"${c.innerText.trim()}" ${Math.round(c.getBoundingClientRect().width)}×${Math.round(
              c.getBoundingClientRect().height
            )}`
        ),
        bottom: Math.round(window.innerHeight - el.getBoundingClientRect().bottom),
      };
    });

    r.check("the consent banner is shown to a first-time visitor", banner !== null, "no .ga-consent");
    if (banner) {
      r.check(
        "it does not cover the bottom tab bar",
        banner.coveredTabs.length === 0,
        banner.coveredTabs.join(", ")
      );
      r.check(
        "every control inside it is tappable",
        banner.smallControls.length === 0,
        banner.smallControls.join(" | ")
      );
    }
    await page.close();
    await fresh.close();
  }

  // The checkbox, specifically. It is the one control the Reality Engine
  // depends on, and the one that shipped invisible.
  const page = await phonePage(browser);
  await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.setItem("acadassist_token", t);
    localStorage.setItem("goalassist_consent", "denied");
  }, token);
  await page.goto(`${FRONTEND}/today`, { waitUntil: "networkidle2" });
  await waitForText(page, "done");
  const box = await page.evaluate(() => {
    const input = document.querySelector("input.ga-check");
    if (!input) return null;
    const s = getComputedStyle(input);
    const label = input.closest("label").getBoundingClientRect();
    return {
      appearance: s.appearance,
      borderWidth: parseFloat(s.borderTopWidth) || 0,
      w: input.getBoundingClientRect().width,
      labelW: label.width,
      labelH: label.height,
    };
  });
  r.check("today has a task with a checkbox", box !== null, "no input.ga-check on /today");
  if (box) {
    r.check(
      "the unchecked checkbox draws its own visible border",
      box.appearance === "none" && box.borderWidth > 0,
      JSON.stringify(box)
    );
    r.check(
      "its tap target clears 44px",
      Math.min(box.labelW, box.labelH) + 0.5 >= CRITICAL_FLOOR,
      `${Math.round(box.labelW)}×${Math.round(box.labelH)}`
    );
  }
  await page.close();
} finally {
  await browser.close();
}

r.finish();
