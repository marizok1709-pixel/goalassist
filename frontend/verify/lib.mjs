/**
 * Shared plumbing for the browser verification suites.
 *
 * These exist because the mobile pass of 2026-08-06 was proven by throwaway
 * puppeteer scripts that no longer exist. Everything CHANGELOG claims about
 * phone layout — no horizontal overflow, no undersized tap targets, a loop you
 * can actually tap through — was true once and is unprovable now. Committed
 * suites turn those claims into something the next CSS change has to survive.
 *
 * Deliberately mirrors the Python smoke tests: the same [PASS]/[FAIL] lines,
 * the same failure list, the same exit code. One habit, two languages.
 */

import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

export const FRONTEND = process.env.VERIFY_FRONTEND ?? "http://localhost:3000";
export const BACKEND = process.env.VERIFY_BACKEND ?? "http://localhost:8000";

/**
 * The baseline. Not a device preset — the owner's decision is that 360×800 is
 * the design target, so that is what gets asserted.
 */
export const PHONE = {
  width: 360,
  height: 800,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function chromePath() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}\n` +
        "Set CHROME_PATH to a Chrome or Chromium binary."
    );
  }
  return found;
}

export async function launch() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    defaultViewport: PHONE,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** A page pinned to the phone viewport with a phone UA, so `isMobile` CSS agrees. */
export async function phonePage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/125.0.0.0 Mobile Safari/537.36"
  );
  await page.setViewport(PHONE);
  return page;
}

// ---------------------------------------------------------------- reporting

export function reporter(title) {
  const failures = [];
  console.log(`\n${title}`);
  return {
    check(label, cond, detail = "") {
      console.log(`[${cond ? "PASS" : "FAIL"}] ${label}${cond ? "" : "  → " + detail}`);
      if (!cond) failures.push(label);
    },
    /** Exit code 0 / 1, printed the way the Python suites print it. */
    finish() {
      console.log();
      if (failures.length) {
        console.log(`${failures.length} FAILURES: ${JSON.stringify(failures)}`);
        process.exitCode = 1;
        return false;
      }
      console.log("ALL CHECKS PASSED");
      return true;
    },
    failures,
  };
}

// ------------------------------------------------------------------ helpers

/** Real TLD on purpose: the backend's EmailStr rejects reserved ones like .test. */
export function uniqueEmail(prefix = "verify") {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}

/**
 * A yyyy-mm-dd `n` days from today, in *local* time.
 *
 * `toISOString()` would be UTC, and east of Greenwich late in the evening that
 * is yesterday — the flow would then be asked for 12 days and told it had 11.
 * The same skew is item 6 on the plan, sitting in the backend's `_today()`.
 */
export function isoInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Set the stored theme the way the layout's bootstrap script reads it. */
export async function setTheme(page, theme) {
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem("goalassist_theme", t);
    } catch {}
  }, theme);
}

/**
 * Click the visible element whose trimmed text matches, without needing a selector.
 *
 * Waits until the element's own centre hit-tests back to itself before
 * clicking, which is what a thumb needs to be true. The steps animate in with
 * a translate, so clicking the instant the text appears aims at where the
 * button was, not where it is — and a click that lands on the backdrop looks
 * exactly like a broken build.
 */
export async function clickText(page, text, selector = "button, a", timeout = 8000) {
  await page.waitForFunction(
    (sel, want) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) => e.textContent.trim().replace(/\s+/g, " ") === want
      );
      if (!el) return false;
      // Scroll it front and centre first, exactly as a user would before
      // tapping something near the bottom edge.
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit) && (hit === el || el.contains(hit));
    },
    { timeout },
    selector,
    text
  );
  const handle = await page.evaluateHandle(
    (sel, want) =>
      [...document.querySelectorAll(sel)].find(
        (e) => e.textContent.trim().replace(/\s+/g, " ") === want
      ) ?? null,
    selector,
    text
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No ${selector} with text "${text}" on ${page.url()}`);
  await el.click();
  return el;
}

/**
 * Wait until the rendered text appears anywhere on the page.
 *
 * Case-insensitive on purpose: the design leans on `text-transform:
 * uppercase`, and `innerText` reports what is painted, so "Mission created" in
 * the source arrives here as "MISSION CREATED".
 */
export async function waitForText(page, text, timeout = 10000) {
  await page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().includes(t),
    { timeout },
    text.toLowerCase()
  );
}

/** Type into a field after clearing it — several inputs ship with a default. */
export async function fill(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, String(value));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------- onboarding driver

/**
 * Walk a brand-new account all the way through the conversational flow, ending
 * on the launch screen. Returns the account so a suite can log back in.
 *
 * `restDays` are labels as rendered on the rhythm step ("Sat", "Sun").
 */
export async function onboard(
  page,
  { title, days = 12, material, amount, unit, restDays = [], onVerdict = null }
) {
  const account = { email: uniqueEmail(), password: "verifypass1", name: "Verify" };

  await page.goto(`${FRONTEND}/onboarding`, { waitUntil: "networkidle2" });
  await clickText(page, "Create your first mission");

  await waitForText(page, "Register");
  await page.type('input[placeholder="username"]', account.name);
  await page.type('input[type="email"]', account.email);
  await page.type('input[type="password"]', account.password);
  await clickText(page, "Create account →");

  await waitForText(page, "What do you want to achieve?");
  await page.type('input[placeholder="type your goal title here"]', title);
  await clickText(page, "Continue →");

  await waitForText(page, "When is the deadline");
  await page.$eval(
    'input[type="date"]',
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    isoInDays(days)
  );
  await clickText(page, "Continue →");

  await waitForText(page, "What materials will get you there?");
  await page.type('input[placeholder="book, PDF or exam collection"]', material);
  await page.type('input[placeholder="how much"]', String(amount));
  // The unit field ships pre-filled with "pages"; typing would concatenate.
  await fill(page, 'input[placeholder="pages, papers, units…"]', unit);
  await clickText(page, "Continue →");

  await waitForText(page, "How far are you already?");
  await clickText(page, "Continue →");

  await waitForText(page, "Which days do you not study?");
  for (const day of restDays) await clickText(page, day, '[role="switch"]');
  await clickText(page, "Check my plan →");

  // The reality check now sits between the last question and creation: the
  // verdict has to arrive before anything is written. Nothing is persisted
  // until "Create mission" is pressed here.
  await waitForText(page, "Create mission", 20000);
  if (onVerdict) await onVerdict(page);
  await clickText(page, "Create mission");

  await waitForText(page, "Mission created", 20000);
  return account;
}
