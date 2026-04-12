#!/usr/bin/env node

/**
 * scraper/run-cities.js
 * ─────────────────────
 * Iterates every city defined in scraper.config.js and runs scrape_jobs.js
 * for each one sequentially with a human-paced inter-city gap.
 *
 * Features:
 *   • Lock file  — prevents concurrent runs if cron fires while a run is live
 *   • Run log    — appends one JSON line per completed run to scraper.log
 *   • Per-city overrides — pages / radius set in config per city
 *   • Graceful shutdown  — removes lock on SIGINT / SIGTERM
 *
 * Usage:
 *   node run-cities.js                     # scrape all cities in config
 *   node run-cities.js --cities Warsaw,Krakow   # override city list
 *   node run-cities.js --pages 2           # override pages for all cities
 *   node run-cities.js --dry-run           # print plan, don't scrape
 *
 * Cron example (every 4 hours, log to file):
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

const DRY_RUN       = hasFlag("--dry-run");
const PAGE_OVERRIDE = getArg("--pages",    "");
const CITY_OVERRIDE = getArg("--cities",   "");  // comma-separated

// Build city list: CLI override > config
let cities = CFG.cities;
if (CITY_OVERRIDE) {
  cities = CITY_OVERRIDE.split(",").map(c => ({ name: c.trim(), pages: CFG.defaultPages, radius: CFG.defaultRadius }));
}
if (PAGE_OVERRIDE) {
  cities = cities.map(c => ({ ...c, pages: parseInt(PAGE_OVERRIDE, 10) }));
}

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

// ── Run a single city scrape as a child process ───────────────────────────────
function scrapeCity(city) {
  const cityArgs = [
    SCRAPER,
    "--city",  city.name,
    "--pages", String(city.pages  ?? CFG.defaultPages),
    "--radius", String(city.radius ?? CFG.defaultRadius),
  ];

  // Pass through S3 config if set
  if (process.env.S3_BUCKET)  cityArgs.push("--s3-bucket", process.env.S3_BUCKET);
  if (process.env.S3_PREFIX)  cityArgs.push("--s3-prefix", process.env.S3_PREFIX);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🏙   City: ${city.name}  (pages=${city.pages}, radius=${city.radius}km)`);
  console.log(`${"─".repeat(60)}\n`);

  const start = Date.now();
  let exitCode = 0;

  try {
    execFileSync(process.execPath, cityArgs, {
      stdio: "inherit",       // stream output live to parent terminal
      env:   process.env,     // pass all env vars (AWS creds, proxy, etc.)
      cwd:   __dirname,
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    console.error(`\n❌  scrape_jobs.js exited with code ${exitCode}`);
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  appendLog({ city: city.name, pages: city.pages, exitCode, durationSec: parseFloat(duration) });
  console.log(`\n⏱   ${city.name} done in ${duration}s  (exit ${exitCode})`);
  return exitCode;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  run-cities.js — ${cities.length} city/cities queued`);
  console.log(`   Cities: ${cities.map(c => c.name).join(", ")}`);
  if (DRY_RUN) {
    console.log("\n⚙   DRY RUN — no scraping will happen\n");
    cities.forEach((c, i) => {
      const gapMs = i < cities.length - 1
        ? CFG.timing.interCityCenter
        : 0;
      console.log(`  [${i + 1}] ${c.name}  pages=${c.pages}  radius=${c.radius}km  gap_after≈${(gapMs/1000).toFixed(0)}s`);
    });
    return;
  }

  acquireLock();

  // Remove lock on clean exit or signals
  const cleanup = () => { releaseLock(); };
  process.on("exit",    cleanup);
  process.on("SIGINT",  () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  const runStart = Date.now();
  let totalListings = 0;
  let totalErrors   = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const exitCode = scrapeCity(city);
    if (exitCode !== 0) totalErrors++;

    // Inter-city human gap (skip after last city)
    if (i < cities.length - 1) {
      const gapSec = (CFG.timing.interCityCenter / 1000).toFixed(0);
      console.log(`\n😴  Waiting ~${gapSec}s before next city (human pace) ...`);
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
  console.log(`✅  All cities done in ${totalSec}s — ${totalErrors} city run(s) with errors`);
  console.log(`${"═".repeat(60)}\n`);

  appendLog({ event: "run_complete", cities: cities.map(c => c.name), totalErrors, totalSec: parseFloat(totalSec) });
  releaseLock();
}

main().catch(err => { releaseLock(); console.error("Fatal:", err); process.exit(1); });
