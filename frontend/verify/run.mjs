/**
 * `npm run verify` — both browser suites, one exit code.
 *
 * Starts nothing. Both servers have to be up already, because the suites
 * register real accounts through the real API and a half-booted stack produces
 * confusing failures rather than honest ones. Point VERIFY_FRONTEND /
 * VERIFY_BACKEND elsewhere to run against a preview deploy — but never against
 * production, which these would pollute with throwaway users.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BACKEND, FRONTEND } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

async function up(url, name) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(
      `\n${name} is not answering at ${url} (${err.message}).\n` +
        "  backend:  cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000\n" +
        "  frontend: cd frontend && npm run dev\n"
    );
    process.exit(1);
  }
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await up(`${BACKEND}/health`, "backend");
await up(FRONTEND, "frontend");

const codes = [];
for (const script of ["mobile.mjs", "loop.mjs"]) codes.push(await run(script));

const failed = codes.filter((c) => c !== 0).length;
console.log(
  failed ? `\n${failed} of ${codes.length} browser suites FAILED` : `\n${codes.length} browser suites passed`
);
process.exit(failed ? 1 : 0);
