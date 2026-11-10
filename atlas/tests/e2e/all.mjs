// Runs every browser test suite, each against a fresh server on the production
// build, so nobody has to start servers by hand.
//   npm run build && npm run e2e:all
// The suites that need ATLAS's own database run when E2E_DATABASE_URL is set
// (the ATLAS tables in that database are dropped first, so never point it at real data).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE = `http://localhost:${PORT}`;
const DB = process.env.E2E_DATABASE_URL;

const demo = { ATLAS_ALLOW_DEMO_LOGINS: "1", ATLAS_ADDRESS_DEMO: "1", ATLAS_AI_DEMO: "1" };
const database = { ATLAS_DATA_SOURCE: "postgres", DATABASE_URL: DB, ATLAS_OWNER_EMAIL: "owner@example.com", ATLAS_OWNER_PASSWORD: "atlas-demo-2026" };
const suites = [
  // The main journey checks the honest "not set up" state of the assistant, so no AI stand-in here.
  { file: "run.mjs", env: { ...demo, ATLAS_AI_DEMO: undefined } },
  { file: "walkthrough.mjs", env: demo },
  { file: "three-projects.mjs", env: demo },
  { file: "assistant-files.mjs", env: demo },
  { file: "suggestions.mjs", env: demo },
  { file: "people.mjs", env: database, db: true },
  { file: "media.mjs", env: database, db: true },
  { file: "safety.mjs", env: database, db: true },
];

const only = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resetDatabase() {
  const { Pool } = createRequire(import.meta.url)("pg");
  const pool = new Pool({ connectionString: DB });
  await pool.query("DROP TABLE IF EXISTS atlas_records, atlas_audit, atlas_imports, atlas_users, atlas_files");
  await pool.end();
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = 0;
const flaky = [];

async function runSuite(s) {
  if (s.db) await resetDatabase();
  // Demo-data variables must not leak into database runs, and the other way round.
  const env = { ...process.env };
  for (const k of ["ATLAS_DATA_SOURCE", "DATABASE_URL", "ATLAS_OWNER_EMAIL", "ATLAS_OWNER_PASSWORD", "ATLAS_USERS_JSON", "ATLAS_ALLOW_DEMO_LOGINS", "ATLAS_ADDRESS_DEMO", "ATLAS_AI_DEMO", "ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "GOOGLE_MAPS_API_KEY", "AIRTABLE_TOKEN"]) delete env[k];
  const server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: { ...env, ...Object.fromEntries(Object.entries(s.env).filter(([, v]) => v !== undefined)), ATLAS_SESSION_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(500);
      up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error("the server didn't start");
    return (await run(process.execPath, [`tests/e2e/${s.file}`], { BASE_URL: BASE })) === 0;
  } catch (e) {
    console.log(`>>> ${s.file}: ${e.message}`);
    return false;
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
}

for (const s of suites) {
  if (only.length && !only.some((o) => s.file.startsWith(o))) continue;
  if (s.db && !DB) { console.log(`\n=== ${s.file}: skipped (set E2E_DATABASE_URL to run it)`); continue; }
  console.log(`\n=== ${s.file}`);
  if (await runSuite(s)) continue;
  // Browser tests sometimes lose a race with a page refresh. One more try on a fresh
  // server; a suite that needed it is named at the end so it gets looked at, not hidden.
  console.log(`>>> ${s.file} failed, trying once more on a fresh server`);
  if (await runSuite(s)) flaky.push(s.file);
  else { failed++; console.log(`>>> ${s.file} FAILED twice`); }
}
if (flaky.length) console.log(`\nPassed only on the second try (unreliable, worth fixing): ${flaky.join(", ")}`);
console.log(failed ? `\n${failed} suite(s) failed` : "\nAll suites passed");
process.exit(failed ? 1 : 0);
