"""Vercel serverless entrypoint.

Vercel's Python runtime treats each file under `api/` as a function and serves
the module-level ASGI `app`. All routes are rewritten here (see vercel.json),
and FastAPI does its own routing from the original request path.
"""
import os
import sys

# The `app` package lives one level up (backend/app); make it importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402,F401
