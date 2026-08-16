"""The planner, on its own. Pure function in, plan out — no database, no HTTP.

Cases 11-18 are the pivot plan's own additions, which exist because the pre-pivot
engine answered the feasibility question one mission at a time. Case 11 is the
one that motivated the rewrite: two missions that each fit comfortably against
the full pool, and do not fit together.

Cases 19-21 carry forward the defects the product actually shipped — the gap
after a missed day and the reversed page range — stated against the new engine so
that a minutes-first allocator cannot reintroduce them through rounding.

A and B are the acceptance scenarios. They are the definition of done.
"""

from datetime import date, timedelta

from app.services import params
from app.services.planner import (
    CapacityIn,
    MaterialIn,
    MissionIn,
    PRIORITY_HIGH,
    PRIORITY_PAUSED,
    RecordIn,
    plan,
)

failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TODAY = date(2026, 8, 15)  # a Saturday, fixed so these never rot


def every_day(hours=2.0):
    return CapacityIn({d: hours * 60 for d in DAYS})


def material(mid, total, done=0.0, mpu=None, unit="pages", name="Book", segments=()):
    return MaterialIn(
        id=mid, name=name, unit=unit, total_units=total, completed_units=done,
        minutes_per_unit=mpu, segments=segments,
    )


def mission(mid, deadline_days, materials, priority="NORMAL", title=None):
    return MissionIn(
        id=mid,
        title=title or f"Mission {mid}",
        deadline=TODAY + timedelta(days=deadline_days),
        start_date=TODAY,
        materials=tuple(materials),
        priority=priority,
    )


def ranges(p, mission_id):
    """(date, lo, hi) for every assignment that names a range."""
    out = []
    for a in p.for_mission(mission_id).days:
        tail = a.label.rsplit(" ", 1)[-1]
        if "-" in tail:
            lo, hi = tail.split("-")
            if lo.isdigit() and hi.isdigit():
                out.append((a.date, int(lo), int(hi)))
    return out


# ---------------------------------------------------------------- case 11
# Two missions, each feasible alone against the whole pool, over capacity
# together. This is the bug the portfolio signature exists to fix.

# 21 study days x 120 min = 2520 minutes in the pool. 400 units at 4 min each
# is 1600 minutes: a ratio of 1.58 alone (COMFORTABLE) and 0.79 when the pool is
# shared (OVER CAPACITY). Those numbers are chosen so the two verdicts land in
# different bands — the whole point of the case is that asking one mission at a
# time gives an answer that is individually true and jointly wrong.
cap = every_day(2.0)  # 14 h/week
a = mission(1, 20, [material(10, 400, mpu=4.0)])   # 1600 min needed
b = mission(2, 20, [material(20, 400, mpu=4.0)])   # 1600 min needed
p = plan([a, b], cap, [], TODAY)                    # 2520 min available total

pa, pb = p.for_mission(1), p.for_mission(2)
check("each mission alone is comfortable",
      pa.verdict_alone == "COMFORTABLE" and pb.verdict_alone == "COMFORTABLE",
      f"{pa.verdict_alone} / {pb.verdict_alone}")
check("together the portfolio is OVER CAPACITY",
      p.verdict == params.VERDICT_OVER, p.verdict)
check("…and so is each of them, once it has to share",
      pa.verdict == params.VERDICT_OVER and pb.verdict == params.VERDICT_OVER,
      f"{pa.verdict} / {pb.verdict}")
check("the pool is shared, not doubled",
      pa.allocated_minutes + pb.allocated_minutes <= p.available_minutes + 1,
      f"{pa.allocated_minutes} + {pb.allocated_minutes} vs {p.available_minutes}")

# And the band boundary is respected rather than being pessimistic everywhere:
# 2400 needed against 2520 available really is feasible.
fits = plan([mission(1, 20, [material(10, 300, mpu=4.0)]),
             mission(2, 20, [material(20, 300, mpu=4.0)])], cap, [], TODAY)
check("two missions that genuinely fit are not called over capacity",
      fits.verdict in ("FEASIBLE", "COMFORTABLE"), fits.verdict)

# ---------------------------------------------------------------- case 12
# A paused mission consumes nothing and the active one gets the whole pool.

paused = mission(2, 20, [material(20, 400, mpu=4.0)], priority=PRIORITY_PAUSED)
p3 = plan([a, paused], cap, [], TODAY)
check("a paused mission is allocated nothing",
      p3.for_mission(2).allocated_minutes == 0, p3.for_mission(2).allocated_minutes)
check("…and receives no scheduled days", p3.for_mission(2).days == [], p3.for_mission(2).days)
# Allocation is capped by demand as well as by capacity, so a mission that can
# finish either way reports the same minutes. Pausing its rival buys it *time*,
# which is why the finish date is the honest thing to compare.
check("pausing the rival moves the survivor's finish earlier",
      p3.for_mission(1).projected_finish < p.for_mission(1).projected_finish,
      f"{p3.for_mission(1).projected_finish} vs {p.for_mission(1).projected_finish}")
check("…and turns it from over capacity into a mission that fits",
      p3.for_mission(1).verdict != params.VERDICT_OVER, p3.for_mission(1).verdict)

# ---------------------------------------------------------------- case 13
# The nearer deadline draws the larger share, with no separate urgency rule.

near = mission(1, 10, [material(10, 300, mpu=4.0)])
far = mission(2, 60, [material(20, 300, mpu=4.0)])
p4 = plan([near, far], cap, [], TODAY)
near_first_week = sum(
    a.minutes for a in p4.for_mission(1).days if a.date < TODAY + timedelta(days=7)
)
far_first_week = sum(
    a.minutes for a in p4.for_mission(2).days if a.date < TODAY + timedelta(days=7)
)
check("the nearer deadline receives the larger early share",
      near_first_week > far_first_week, f"{near_first_week} vs {far_first_week}")
check("the further mission is not starved — the weekly floor holds",
      far_first_week > 0, far_first_week)

# ---------------------------------------------------------------- case 14
# Eight declared hours are planned at four. Nobody does eight productive hours.

big = CapacityIn({d: 8 * 60 for d in DAYS})
p5 = plan([mission(1, 6, [material(10, 10_000, mpu=4.0)])], big, [], TODAY)
day_one = sum(a.minutes for a in p5.for_mission(1).days if a.date == TODAY)
check("a declared 8-hour day is planned at the 4-hour cap",
      abs(day_one - params.DAILY_EFFECTIVE_CAP_MINUTES) <= 4.0, day_one)
check("the cap is reported so the screen can show it",
      p5.daily_cap_minutes == params.DAILY_EFFECTIVE_CAP_MINUTES, p5.daily_cap_minutes)

# ---------------------------------------------------------------- case 15/16
# Load change after a miss: absorbed silently under the threshold, surfaced over.

base = mission(1, 30, [material(10, 300, mpu=4.0)])
p_before = plan([base], cap, [], TODAY)
load_before = p_before.for_mission(1).pace_planned_units

missed_one = mission(1, 29, [material(10, 300, mpu=4.0)])
p_small = plan([missed_one], cap, [], TODAY)
rise_small = p_small.for_mission(1).pace_planned_units / load_before - 1
check("one missed day out of thirty is under the acknowledgment threshold",
      rise_small < params.LOAD_CHANGE_THRESHOLD, f"{rise_small:.3f}")

missed_many = mission(1, 30, [material(10, 300, mpu=4.0)])
tight_cap = CapacityIn({"mon": 120.0, "tue": 0.0, "wed": 0.0, "thu": 0.0,
                        "fri": 0.0, "sat": 0.0, "sun": 0.0})
p_big = plan([missed_many], tight_cap, [], TODAY)
rise_big = p_big.for_mission(1).pace_planned_units / load_before - 1
check("losing most of the week is over the threshold",
      rise_big > params.LOAD_CHANGE_THRESHOLD, f"{rise_big:.3f}")

# ---------------------------------------------------------------- case 17
# Observed pace diverging from the estimate is visible, from the trailing window.

history = [
    RecordIn(mission_id=1, date=TODAY - timedelta(days=i), planned_units=10,
             actual_units=6, status="PARTIAL")
    for i in range(1, 6)
]
p6 = plan([base], cap, history, TODAY)
check("actual pace is reported from history",
      p6.for_mission(1).pace_actual_units == 6.0, p6.for_mission(1).pace_actual_units)
check("a mission with no history reports no actual pace",
      p_before.for_mission(1).pace_actual_units is None,
      p_before.for_mission(1).pace_actual_units)
check("skipped days are not averaged in as zeroes",
      plan([base], cap,
           history + [RecordIn(1, TODAY - timedelta(days=6), 10, 0, status="SKIPPED")],
           TODAY).for_mission(1).pace_actual_units == 6.0)

# ---------------------------------------------------------------- case 18
# Nothing left to do is COMPLETED, and schedules nothing.

done = mission(1, 20, [material(10, 300, done=300, mpu=4.0)])
p7 = plan([done], cap, [], TODAY)
check("a finished mission is COMPLETED", p7.for_mission(1).verdict == params.VERDICT_COMPLETED,
      p7.for_mission(1).verdict)
check("…and is given no days", p7.for_mission(1).days == [], p7.for_mission(1).days)

# ---------------------------------------------------------------- case 19
# The cursor. Contiguous, monotone, and it starts where the student actually is.

p8 = plan([mission(1, 30, [material(10, 200, done=106, mpu=2.0)])], cap, [], TODAY)
rr = ranges(p8, 1)
check("the first range starts one past the live position", rr[0][1] == 107, rr[:2])
check("every range starts one past the previous one",
      all(rr[i + 1][1] == rr[i][2] + 1 for i in range(len(rr) - 1)),
      [r for i, r in enumerate(rr[:-1]) if rr[i + 1][1] != r[2] + 1][:3])
check("no range ever goes backwards",
      all(rr[i + 1][1] > rr[i][2] for i in range(len(rr) - 1)), rr[:6])
check("the plan runs to the end of the material", rr[-1][2] == 200, rr[-1])

# ---------------------------------------------------------------- case 20
# A zero-hour day is never scheduled — this is what `/today/more` violated.

weekdays = CapacityIn({"mon": 120.0, "tue": 120.0, "wed": 120.0, "thu": 120.0,
                       "fri": 120.0, "sat": 0.0, "sun": 0.0})
p9 = plan([mission(1, 40, [material(10, 200, mpu=4.0)])], weekdays, [], TODAY)
weekend = [a.date for a in p9.for_mission(1).days if a.date.weekday() >= 5]
check("no work lands on a zero-hour day", not weekend, weekend[:5])

# ---------------------------------------------------------------- case 21
# Discrete items keep their own title instead of becoming a meaningless range.

exam = material(30, 1, unit="mock exam", name="Modelprufung", mpu=180.0,
                segments=((1, "Modelprufung: mock exam #1", 1.0, 0.0),))
p10 = plan([mission(1, 40, [exam])], cap, [], TODAY)
check("a whole discrete item keeps its title",
      p10.for_mission(1).days[0].label == "Modelprufung: mock exam #1",
      p10.for_mission(1).days[0].label)

# ---------------------------------------------------------------- no estimate
# With no minutes anywhere, there is no date — but there is a checkable number.

p11 = plan([mission(1, 16, [material(10, 1497, done=106, unit="points",
                                     name="Stepik problems")])],
           CapacityIn({"mon": 0.0, "tue": 120.0, "wed": 120.0, "thu": 0.0,
                       "fri": 120.0, "sat": 0.0, "sun": 120.0}), [], TODAY)
m11 = p11.for_mission(1)
check("a mission with no estimate gets no invented finish date",
      m11.projected_finish is None and m11.uses_minutes is False,
      f"{m11.projected_finish} / {m11.uses_minutes}")
check("its verdict says so rather than guessing",
      m11.verdict == params.VERDICT_NO_ESTIMATE, m11.verdict)
check("but it still states a rate the student can judge",
      m11.required_units_per_hour is not None and m11.required_units_per_hour > 70,
      m11.required_units_per_hour)

# ---------------------------------------------------------------- ACCEPTANCE A
# "Mit Erfolg zum digitalen TestDaF, done 80 pages, need it by Nov 12,
#  about 12h a week." → a verdict, a projected finish date, and today's work
#  in units and minutes, with the student computing nothing.

nov12 = (date(2026, 11, 12) - TODAY).days
twelve_h = CapacityIn({"mon": 120.0, "tue": 120.0, "wed": 120.0, "thu": 120.0,
                       "fri": 120.0, "sat": 120.0, "sun": 0.0})  # 12 h/week
scenario_a = mission(1, nov12, [material(10, 161, done=80, mpu=6.0,
                                         unit="pages",
                                         name="Mit Erfolg zum digitalen TestDaF")])
pa_plan = plan([scenario_a], twelve_h, [], TODAY)
ma = pa_plan.for_mission(1)
check("A: a feasibility verdict", ma.verdict in
      ("COMFORTABLE", "FEASIBLE", "TIGHT", params.VERDICT_OVER), ma.verdict)
check("A: a projected finish date", ma.projected_finish is not None, ma.projected_finish)
check("A: it fits, and finishes on or before the deadline",
      ma.projected_finish <= ma.deadline and ma.days_late == 0,
      f"{ma.projected_finish} vs {ma.deadline}")
today_work = [x for x in ma.days if x.date == TODAY]
check("A: today's work is stated in units", today_work and today_work[0].units > 0, today_work)
check("A: …and in minutes", today_work and today_work[0].minutes > 0, today_work)
print(f"       A → {ma.verdict}, finish {ma.projected_finish}, "
      f"today {today_work[0].units:g} pages / {today_work[0].minutes:g} min")

# ---------------------------------------------------------------- ACCEPTANCE B
# 1,400 problems, 8h a week, deadline Aug 31. The engine must state plainly that
# this finishes later than the deadline — neither silently accepting it nor
# refusing to let the student proceed.

aug31 = (date(2026, 8, 31) - TODAY).days
eight_h = CapacityIn({"mon": 0.0, "tue": 120.0, "wed": 120.0, "thu": 0.0,
                      "fri": 120.0, "sat": 0.0, "sun": 120.0})  # 8 h/week
scenario_b = mission(1, aug31, [material(10, 1400, mpu=3.0, unit="problems",
                                         name="Stepik problems")])
pb_plan = plan([scenario_b], eight_h, [], TODAY)
mb = pb_plan.for_mission(1)
check("B: the verdict is OVER CAPACITY, not silent acceptance",
      mb.verdict == params.VERDICT_OVER, mb.verdict)
check("B: it names a real finish date past the deadline",
      mb.projected_finish is not None and mb.projected_finish > mb.deadline,
      f"{mb.projected_finish} vs {mb.deadline}")
check("B: and says how late, in days", mb.days_late > 0, mb.days_late)
check("B: the plan is still produced — the student is never blocked",
      len(mb.days) > 0 and mb.remaining_units == 1400, len(mb.days))
check("B: work continues past the deadline rather than stopping at it",
      any(x.beyond_deadline for x in mb.days), "nothing scheduled past the deadline")
print(f"       B → {mb.verdict}, deadline {mb.deadline}, "
      f"projected finish {mb.projected_finish} ({mb.days_late} days late)")

# ---------------------------------------------------------------- the owner's own two
# The pivot's stated done-when: 8 h/week does not cover both live missions.

testdaf = mission(1, (date(2026, 11, 10) - TODAY).days,
                  [material(10, 161, done=21, mpu=6.0, unit="pages",
                            name="Mit Erfolg zum digitalen TestDAF")],
                  title="TestDAF TDN16")
ege = mission(2, (date(2026, 8, 31) - TODAY).days,
              [material(20, 1497, done=106, mpu=3.0, unit="points",
                        name="Stepik problems")],
              title="EGE math")
real = plan([testdaf, ege], eight_h, [], TODAY)
check("the owner's real portfolio reports OVER CAPACITY",
      real.verdict == params.VERDICT_OVER, real.verdict)
check("…driven by EGE math, not TestDaF",
      real.for_mission(2).verdict == params.VERDICT_OVER
      and real.for_mission(1).verdict != params.VERDICT_OVER,
      f"TestDAF {real.for_mission(1).verdict} / EGE {real.for_mission(2).verdict}")
check("TestDaF still gets its weekly floor while EGE dominates",
      len(real.for_mission(1).days) > 0, "TestDaF starved")
for mp in real.missions:
    print(f"       {mp.title:14} {mp.verdict:13} finish {mp.projected_finish} "
          f"({mp.days_late}d late)  alone: {mp.verdict_alone}")

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
