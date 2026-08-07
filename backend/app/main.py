import math
import os
import time

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .metrics import metrics

from .database import Base, engine
from .migrate import ensure_columns
from .routers import admin, auth, goals, plan, privacy

Base.metadata.create_all(bind=engine)
# create_all() never alters an existing table, so additive columns are applied
# separately. Idempotent; a no-op on a fresh database.
ensure_columns(engine)

app = FastAPI(title="AcadAssist API", version="0.1.0")

# Allowed browser origins. Local dev defaults to the Next.js dev server; in
# production set CORS_ORIGINS to a comma-separated list including the Vercel
# frontend URL (e.g. "https://goalassist.vercel.app").
_default_origins = "http://localhost:3000"
allow_origins = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _json_safe(value):
    """Make an error body always serialisable.

    FastAPI's default 422 echoes the offending input and validator context. Two
    things in there break json.dumps() and turn a clean 422 into a 500:
      * a NaN/Infinity input value (the original break-test finding), and
      * a raised exception *object* that pydantic parks in ctx['error'] (found
        when the deadline validator itself started raising ValueError).
    Recurse the structure, stringify any non-finite float, and stringify any
    leaf that is not a JSON-native type. Closes the whole class, not one case.
    """
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return str(value)  # exceptions and any other exotic leaf


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": _json_safe(exc.errors())},
    )


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    """Time every request so /admin/infrastructure has something real to show.

    Wrapped in try/finally: a handler that raises must still be counted, and a
    metrics failure must never take down a request.
    """
    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        try:
            metrics.record(
                (time.perf_counter() - started) * 1000,
                status_code,
                request.url.path,
            )
        except Exception:
            pass


app.include_router(auth.router)
app.include_router(goals.router)
app.include_router(plan.router)
app.include_router(privacy.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok"}
