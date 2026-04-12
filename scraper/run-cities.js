#!/usr/bin/env node

/**
 * scraper/run-cities.js
 * ─────────────────────
 * Iterates every search profile defined in scraper.config.js and runs
 * scrape_jobs.js for each one sequentially with a human-paced gap.
 *
 * Features:
 *   • Lock file  — prevents concurrent runs if cron fires while a run is live
 *   • Run log    — appends one JSON line per completed run to scraper.log
 *   • Per-profile overrides — all params set in config per search key
 *   • Graceful shutdown  — removes lock on SIGINT / SIGTERM
 *
 * Usage:
 *   node run-cities.js                        # run all enabled profiles
 *   node run-cities.js --searches 01,03       # run specific profiles by key
 *   node run-cities.js --pages 2              # override pages for all profiles
 *   node run-cities.js --dry-run              # print plan, don't scrape
 *
 * Cron example (every 4 hours):
 *   0 *\/4 * * *  cd /path/to/careers-surf && bash scraper/scrape.sh >> scraper/cron.log 2>&1
 */

const { execFileSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const CFG = require("./scraper.config.js");

// ── CLI ───────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, fallback) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const hasFlag = (flag) => args.includes(flag);

const DRY_RUN        = hasFlag("--dry-run");
const PAGE_OVERRIDE  = getArg("--pages",    "");
const SEARCH_FILTER  = getArg("--searches", "");  // comma-separated keys, e.g. "01,03"

// Build the list of profiles to run: CLI filter > all enabled in config
const allSearches = CFG.searches;
let searchKeys = Object.keys(allSearches).filter(k => allSearches[k].enabled !== false);

if (SEARCH_FILTER) {
  searchKeys = SEARCH_FILTER.split(",").map(s => s.trim()).filter(k => {
    if (!allSearches[k]) { console.warn(`⚠   Unknown search key "${k}" — skipping`); return false; }
    return true;
  });
}

const searches = searchKeys.map(key => ({ key, ...allSearches[key] }));
if (PAGE_OVERRIDE) searches.forEach(s => { s.pages = parseInt(PAGE_OVERRIDE, 10); });

// ── Paths ─────────────────────────────────────────────────────────────────────
const LOCK_FILE = path.resolve(__dirname, CFG.orchestrator.lockFile);
const LOG_FILE  = path.resolve(__dirname, CFG.orchestrator.logFile);
const SCRAPER   = path.resolve(__dirname, "scrape_jobs.js");

// ── Timing helpers ────────────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function humanDelay({ center, spread, min, max }) {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round(center + z * spread);
  return delay(Math.max(min, Math.min(max, ms)));
}

// ── Lock file ─────────────────────────────────────────────────────────────────
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existing = fs.readFileSync(LOCK_FILE, "utf8").trim();
    // Check if the PID in the lock file is still running
    try {
      process.kill(parseInt(existing, 10), 0);  // signal 0 = check existence
      console.error(`\n🔒  Another scraper run is active (PID ${existing}). Exiting.\n`);
      process.exit(0);
    } catch (_) {
      // PID is gone — stale lock, clean it up
      console.warn(`⚠   Removing stale lock file (PID ${existing} is no longer running)`);
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

// ── Run log ───────────────────────────────────────────────────────────────────
function appendLog(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n";
  fs.appendFileSync(LOG_FILE, line, "utf8");
}

// ── Run a single search profile as a child process ───────────────────────────
function scrapeSearch(search) {
  const searchArgs = [
    SCRAPER,
    "--search", search.key,
  ];

  // Per-profile page override (from --pages CLI flag)
  if (PAGE_OVERRIDE) searchArgs.push("--pages", String(search.pages));

  // Pass through S3 config if set
  if (process.env.S3_BUCKET) searchArgs.push("--s3-bucket", process.env.S3_BUCKET);
  if (process.env.S3_PREFIX) searchArgs.push("--s3-prefix", process.env.S3_PREFIX);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔑  [${search.key}] ${search.label || search.key}`);
  if (search.location) console.log(`   📍  location=${search.location}  radius=${search.radius ?? CFG.defaultRadius}km`);
  if (search.keyword)  console.log(`   🔤  keyword="${search.keyword}"`);
  if (search.workMode) console.log(`   💼  workMode=${search.workMode}`);
  console.log(`   📄  pages=${search.pages ?? CFG.defaultPages}  outputSlug=${search.outputSlug || "—"}`);
  console.log(`${"─".repeat(60)}\n`);

  const start = Date.now();
  let exitCode = 0;

  try {
    execFileSync(process.execPath, searchArgs, {
      stdio: "inherit",
      env:   process.env,
      cwd:   __dirname,
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    console.error(`\n❌  scrape_jobs.js exited with code ${exitCode}`);
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  appendLog({ key: search.key, label: search.label, exitCode, durationSec: parseFloat(duration) });
  console.log(`\n⏱   [${search.key}] done in ${duration}s  (exit ${exitCode})`);
  return exitCode;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  run-cities.js — ${searches.length} search profile(s) queued`);
  searches.forEach(s => console.log(`   [${s.key}] ${s.label || s.key}`));

  if (DRY_RUN) {
    console.log("\n⚙   DRY RUN — no scraping will happen\n");
    searches.forEach((s, i) => {
      const gapMs = i < searches.length - 1 ? CFG.timing.interCityCenter : 0;
      const loc   = s.location ? `location=${s.location}` : s.keyword ? `keyword="${s.keyword}"` : "no filter";
      console.log(`  [${s.key}] ${s.label || s.key}  —  ${loc}  pages=${s.pages ?? CFG.defaultPages}  gap_after≈${(gapMs/1000).toFixed(0)}s`);
    });
    return;
  }

  acquireLock();
  process.on("exit",    () => releaseLock());
  process.on("SIGINT",  () => { releaseLock(); process.exit(130); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

  const runStart = Date.now();
  let totalErrors = 0;

  for (let i = 0; i < searches.length; i++) {
    const search = searches[i];
    const exitCode = scrapeSearch(search);
    if (exitCode !== 0) totalErrors++;

    if (i < searches.length - 1) {
      const gapSec = (CFG.timing.interCityCenter / 1000).toFixed(0);
      console.log(`\n😴  Waiting ~${gapSec}s before next search profile (human pace) ...`);
      await humanDelay({
        center: CFG.timing.interCityCenter,
        spread: CFG.timing.interCitySpread,
        min:    CFG.timing.interCityMin,
        max:    CFG.timing.interCityMax,
      });
    }
  }

  const totalSec = ((Date.now() - runStart) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅  All profiles done in ${totalSec}s — ${totalErrors} profile(s) with errors`);
  console.log(`${"═".repeat(60)}\n`);

  appendLog({ event: "run_complete", keys: searches.map(s => s.key), totalErrors, totalSec: parseFloat(totalSec) });
  releaseLock();
}

main().catch(err => { releaseLock(); console.error("Fatal:", err); process.exit(1); });
