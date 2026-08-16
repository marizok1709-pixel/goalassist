"""What day it is for a particular student.

Every date-triggered behaviour in the product hangs off one question — *is it
still today?* — and until now the answer was `datetime.now().date()`: the
server's local date. On Vercel that is UTC. Berlin is UTC+1/+2, so between local
midnight and 02:00 the API still believed it was the previous day and served the
previous day's tasks, which is how a row for yesterday was reachable and got
ticked. There is no audit trail proving that is what happened, but it is the only
window in which it was possible.

The planner adds four more behaviours to that boundary — missed-day detection,
the trailing pace window, the once-a-day catch-up, and the load-change threshold
— so the boundary has to be the student's rather than the machine's.

`User.timezone` is NULL for every account created before this existed. Those keep
the old server-local answer rather than being moved to a zone nobody chose.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def today_for(user) -> date:
    """The student's current date, falling back to the server's."""
    tz = getattr(user, "timezone", None)
    if tz:
        try:
            return datetime.now(ZoneInfo(tz)).date()
        except (ZoneInfoNotFoundError, ValueError):
            # A zone we cannot resolve is a bad stored string, not a reason to
            # fail a request. Fall through to the server clock.
            pass
    return datetime.now().date()


def is_valid_timezone(tz: str | None) -> bool:
    if not tz:
        return False
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True
