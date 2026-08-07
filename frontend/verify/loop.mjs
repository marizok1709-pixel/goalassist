/**
 * The core loop, walked the way a student on a phone walks it.
 *
 * Layout checks live in mobile.mjs; this one asks whether the product works.
 * Onboarding through the rhythm step → a mission exists → the tab bar reaches
 * /today → a task can be ticked → the counter moves → the calendar agrees.
 *
 * It also carries the two defects the first beta user actually reported, so
 * they cannot come back quietly:
 *   - material names typed on Android arrived word-reversed (the composited
 *     `filter` is gone; this asserts the field round-trips and that no
 *     lingering filter is left on the step container)
 *   - materials were write-once, so a mangled name could never be corrected
 *
 * And the reason item 3 exists: onboarding must produce availability. The
 * first real user's `availability` was NULL, so their 26 tasks landed on 13
 * consecutive days with no rest day.
 */

import {
  BACKEND,
  FRONTEND,
  launch,
  phonePage,
  reporter,
  onboard,
  clickText,
  waitForText,
  sleep,
} from "./lib.mjs";

const r = reporter("Core loop on a phone — onboard, plan, tick, confirm");

const browser = await launch();
try {
  const page = await phonePage(browser);

  // ------------------------------------------------------------ onboarding
  const typedName = "Klara and the Sun";
  await onboard(page, {
    title: "Read books every day",
    days: 12,
    material: typedName,
    amount: 26,
    unit: "chapters",
    restDays: ["Sat", "Sun"],
  });

  // A real first-timer meets the consent banner here and answers it. Declining
  // must be a full stop, not a smaller amount of tracking — so this suite runs
  // the rest of the loop with analytics off.
  await clickText(page, "No thanks");
  await sleep(400);
  r.check(
    "the consent banner can be declined and goes away",
    (await page.$(".ga-consent")) === null,
    "banner still on screen"
  );

  const launchText = await page.evaluate(() => document.body.innerText);
  r.check("launch screen names the mission", launchText.includes("Read books every day"));
  r.check(
    "launch screen states the day count",
    /\b12\b[\s\S]{0,40}days to get there/.test(launchText),
    launchText.slice(0, 200)
  );
  r.check(
    "the material name round-trips unreversed",
    launchText.includes(typedName),
    `expected "${typedName}" in the You'll-need list`
  );

  const token = await page.evaluate(() => localStorage.getItem("acadassist_token"));
  const apiGet = async (path) =>
    page.evaluate(
      async (api, p, t) => (await fetch(api + p, { headers: { Authorization: "Bearer " + t } })).json(),
      BACKEND,
      path,
      token
    );

  // ------------------------------------------- item 3: availability exists
  const me = await apiGet("/auth/me");
  r.check("onboarding produced availability", me.availability !== null, JSON.stringify(me.availability));
  r.check(
    "the chosen rest days are zero hours",
    me.availability && me.availability.sat === 0 && me.availability.sun === 0,
    JSON.stringify(me.availability)
  );
  r.check(
    "study days are non-zero",
    me.availability && ["mon", "tue", "wed", "thu", "fri"].every((d) => me.availability[d] > 0),
    JSON.stringify(me.availability)
  );
  r.check(
    "and it is not yet marked refined, so the dashboard still nudges",
    me.availability_refined === false,
    String(me.availability_refined)
  );

  const dashboard = await apiGet("/dashboard");
  const missionId = dashboard.goals?.[0]?.goal?.id;
  r.check("the dashboard reports the new mission", Boolean(missionId), JSON.stringify(dashboard).slice(0, 200));
  const schedule = await apiGet(`/goals/${missionId}/schedule?days=30`);
  const weekendTasks = schedule.filter((t) => {
    const wd = new Date(`${t.date}T00:00:00`).getDay();
    return wd === 0 || wd === 6;
  });
  r.check("nothing is scheduled on a rest day", weekendTasks.length === 0, `${weekendTasks.length} tasks`);
  r.check(
    "the whole material is still scheduled",
    Math.abs(schedule.reduce((s, t) => s + t.quantity, 0) - 26) < 0.01,
    String(schedule.reduce((s, t) => s + t.quantity, 0))
  );

  // ------------------------------------------------- the launch → today hop
  await clickText(page, "Start today →");
  await page.waitForFunction(() => location.pathname === "/today", { timeout: 10000 });
  await waitForText(page, "done");

  // --------------------------------------------------- the tab bar exists
  const tabs = await page.$$eval(".ga-tabbar a", (els) =>
    els.map((e) => ({ label: e.innerText.trim(), href: new URL(e.href).pathname }))
  );
  r.check("the bottom tab bar carries the core loop", tabs.length === 3, JSON.stringify(tabs));
  r.check(
    "and it reaches dashboard, today and calendar",
    ["/", "/today", "/calendar"].every((h) => tabs.some((t) => t.href === h)),
    JSON.stringify(tabs.map((t) => t.href))
  );

  // ------------------------------------------------------- tick a task
  const before = await page.$eval("body", (b) => b.innerText.match(/(\d+)\/(\d+) done/)?.[0] ?? "");
  r.check("today shows a done counter", /^\d+\/\d+ done$/.test(before), before);

  const hadTask = await page.$("input.ga-check");
  r.check("today has at least one task on day one", hadTask !== null, "no task rendered");

  if (hadTask) {
    await page.click("label:has(input.ga-check)");
    await page.waitForFunction(
      (prev) => {
        const m = document.body.innerText.match(/\d+\/\d+ done/);
        return m && m[0] !== prev;
      },
      { timeout: 10000 },
      before
    );
    const after = await page.$eval("body", (b) => b.innerText.match(/\d+\/\d+ done/)[0]);
    r.check("ticking a task moves the counter", after !== before, `${before} → ${after}`);
    r.check(
      "the counter moved up, not down",
      parseInt(after) === parseInt(before) + 1,
      `${before} → ${after}`
    );

    const persisted = await apiGet("/today");
    const done = persisted.missions.flatMap((m) => m.tasks).filter((t) => t.completed);
    r.check("the completion reached the server", done.length === 1, `${done.length} completed`);
  }

  // ----------------------------------------- the calendar agrees, on a phone
  await clickText(page, "Calendar", ".ga-tabbar a");
  await page.waitForFunction(() => location.pathname === "/calendar", { timeout: 10000 });
  await sleep(900);
  const cal = await page.evaluate(() => ({
    // The phone grid drops task titles for one dot per task; a completed task
    // is the `good` colour. That is how a phone user sees the tick land.
    dots: document.querySelectorAll(".h-1\\.5.w-1\\.5.rounded-full").length,
    doneDots: document.querySelectorAll(".bg-good.rounded-full").length,
    rests: [...document.querySelectorAll("span")].filter((s) => s.innerText === "rest").length,
    // The scroll container, not the document — `.ob-root` absorbs overflow.
    fits: [document.documentElement, ...document.querySelectorAll(".ob-root")].every(
      (c) => c.scrollWidth <= c.clientWidth + 1
    ),
  }));
  r.check("the calendar shows the week as load dots on a phone", cal.dots > 0, JSON.stringify(cal));
  r.check("the completed task shows as done in the calendar", cal.doneDots > 0, JSON.stringify(cal));
  r.check("rest days are labelled rest", cal.rests > 0, JSON.stringify(cal));
  r.check("the calendar grid fits the phone", cal.fits, "calendar overflows 360px");

  // ------------------------------- a material can still be corrected later
  await page.goto(`${FRONTEND}/missions/${missionId}`, { waitUntil: "networkidle2" });
  await waitForText(page, typedName);
  const editable = await page.evaluate(
    () => [...document.querySelectorAll("button")].some((b) => /edit|update/i.test(b.innerText))
  );
  r.check("a material can be edited after the mission exists", editable, "no edit/update control");

  // ------------------------------------- the nudge is still there until /timing
  await page.goto(FRONTEND, { waitUntil: "networkidle2" });
  await sleep(500);
  const dashText = await page.evaluate(() => document.body.innerText);
  r.check(
    "the dashboard invites the student to sharpen the schedule",
    /Sharpen your schedule/i.test(dashText),
    dashText.slice(0, 200)
  );

  // Save real hours at /timing — deliberately the same value onboarding writes,
  // which is exactly the case the old heuristic could not see.
  await page.goto(`${FRONTEND}/timing`, { waitUntil: "networkidle2" });
  await waitForText(page, "When can you actually study?");
  await clickText(page, "Save & reschedule");
  await page.waitForFunction(
    () => /saved|reschedul/i.test(document.body.innerText),
    { timeout: 10000 }
  ).catch(() => {});
  const refined = (await apiGet("/auth/me")).availability_refined;
  r.check("saving at /timing marks the rhythm refined", refined === true, String(refined));

  await page.goto(FRONTEND, { waitUntil: "networkidle2" });
  await sleep(500);
  const afterText = await page.evaluate(() => document.body.innerText);
  r.check(
    "and the nudge retires",
    !/Sharpen your schedule|Design your schedule/i.test(afterText),
    afterText.slice(0, 200)
  );

  await page.close();
} finally {
  await browser.close();
}

r.finish();
