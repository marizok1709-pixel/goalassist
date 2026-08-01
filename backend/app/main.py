import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers import auth, goals, plan

Base.metadata.create_all(bind=engine)

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

app.include_router(auth.router)
app.include_router(goals.router)
app.include_router(plan.router)


@app.get("/health")
def health():
    return {"status": "ok"}
