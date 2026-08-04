"""In-process request metrics.

Deliberately small: a bounded ring of recent request samples plus counters. No
Prometheus, no StatsD, no extra dependency — at this size that would be more
moving parts than the thing being measured.

**Important caveat, surfaced in the API response rather than buried here:** on
serverless these numbers describe *one warm instance*, not the fleet. Vercel
Fluid Compute reuses instances, so the window is usually meaningful, but a
cold start resets it and a second instance keeps its own. They are a live health
signal, not billing-grade telemetry. Anything needing fleet-wide accuracy has to
come from the platform's own observability.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock

# Roughly the last few minutes of traffic at this app's volume.
MAX_SAMPLES = 500


@dataclass
class _Sample:
    at: float
    duration_ms: float
    status: int
    path: str


@dataclass
class RequestMetrics:
    started_at: float = field(default_factory=time.time)
    samples: deque[_Sample] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    total_requests: int = 0
    total_errors: int = 0
    _lock: Lock = field(default_factory=Lock)

    def record(self, duration_ms: float, status: int, path: str) -> None:
        with self._lock:
            self.total_requests += 1
            if status >= 500:
                self.total_errors += 1
            self.samples.append(_Sample(time.time(), duration_ms, status, path))

    def snapshot(self, window_seconds: int = 300) -> dict:
        cutoff = time.time() - window_seconds
        with self._lock:
            recent = [s for s in self.samples if s.at >= cutoff]
            total_requests = self.total_requests
            total_errors = self.total_errors

        durations = sorted(s.duration_ms for s in recent)
        failed = [s for s in recent if s.status >= 400]
        server_errors = [s for s in recent if s.status >= 500]

        def pct(p: float) -> float:
            if not durations:
                return 0.0
            # Nearest-rank; with few samples anything fancier is false precision.
            idx = min(len(durations) - 1, int(round(p / 100 * len(durations) + 0.5)) - 1)
            return round(durations[max(idx, 0)], 1)

        return {
            "window_seconds": window_seconds,
            "requests_in_window": len(recent),
            "requests_per_minute": round(len(recent) / (window_seconds / 60), 2),
            "latency_ms": {
                "p50": pct(50),
                "p95": pct(95),
                "p99": pct(99),
                "max": round(durations[-1], 1) if durations else 0.0,
            },
            "failed_requests": len(failed),
            "server_errors": len(server_errors),
            "error_rate_pct": round(100 * len(server_errors) / len(recent), 2) if recent else 0.0,
            "lifetime": {
                "requests": total_requests,
                "errors": total_errors,
                "uptime_seconds": round(time.time() - self.started_at),
            },
        }


metrics = RequestMetrics()
