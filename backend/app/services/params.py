"""Every number that changes what the planner concludes, in one file.

The product's claim is *math you can check*. A constant buried in a function
body breaks that claim twice over: the student cannot see it, and neither can we
when a verdict looks wrong. So they live here, named, with the reasoning
attached, and the planner imports them rather than spelling them out.

Two of these are not merely tunable — they decide the verdict, and principle 3
says an assumption that decides the verdict has to be visible to the *student*,
not just to us. Those are marked STUDENT-VISIBLE and the reality-check screen is
required to show them with a way to override.
"""

# STUDENT-VISIBLE. Nobody does eight productive hours of unseen material. A
# student who declares 8h gets planned at 4, and the honest place to argue about
# that is the screen that delivers the verdict — not this file.
#
# It matters most exactly where it is least welcome: recovery plans lean on
# high-capacity days, so without a cap the planner is at its most optimistic
# precisely when the student is most behind.
DAILY_EFFECTIVE_CAP_MINUTES = 240.0

# Ratio of available time to required time. Deliberately soft: an early
# minutes-per-unit estimate carries roughly ±50% error, so 0.98 against 1.02 is
# noise in the costume of a decision. This is why the planner's headline output
# is always a date and never a band on its own.
VERDICT_BANDS = (
    (1.20, "COMFORTABLE"),
    (1.00, "FEASIBLE"),
    (0.80, "TIGHT"),
)
# Below the last band. Named for the lever, not the diagnosis — "INFEASIBLE"
# tells a student to give up, "OVER CAPACITY" tells them what to change.
VERDICT_OVER = "OVER_CAPACITY"
# No minutes estimate exists yet, so no ratio can be computed. The planner still
# states the required units-per-hour, which a student can judge for themselves.
VERDICT_NO_ESTIMATE = "NO_ESTIMATE"
VERDICT_COMPLETED = "COMPLETED"

# Study days per week reserved for each active mission before demand rate
# splits the remainder. Without it, allocation by demand rate hands a near
# deadline everything and starves the further mission completely — correct for
# throughput, wrong for a language exam, where a fortnight of silence costs more
# than the hours are worth. One slot is the smallest unit the weekly
# availability model can express.
WEEKLY_FLOOR_SLOTS = 1

# Trailing window for observed pace. A lifetime average cannot notice that the
# last fortnight went badly, which is the only thing a projection needs to know.
PACE_WINDOW_STUDY_DAYS = 7

# How much the remaining daily load may grow before the student is told. Under
# this, absorb the miss silently — the plan simply holds more tomorrow. A metric
# that lurches on one missed Tuesday gets ignored inside a fortnight, which is
# the death the old WARNING banner was dying.
LOAD_CHANGE_THRESHOLD = 0.15

# Used when a material has no minutes estimate, purely so one allocation code
# path serves both cases. With every material nominal, allocation degenerates to
# "proportional to remaining units", which is exactly what the pre-pivot engine
# did. It is never shown, and never used to compute a finish date.
NOMINAL_MINUTES_PER_UNIT = 1.0

# How far past a deadline the simulation will run to find where work actually
# lands. This is what turns "you will miss it" into "you finish on Sept 6".
PROJECTION_HORIZON_DAYS = 730

EPS = 1e-9
