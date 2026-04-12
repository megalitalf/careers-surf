/**
 * phases/lib.js
 * ─────────────
 * Shared utilities used by all three pipeline phases (scrape / normalize / upload).
 * Import with:  const lib = require("./lib");
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");

// ── .env loader ───────────────────────────────────────────────────────────────
// Call once at the top of each phase script, before anything reads process.env.
// Values already set in the environment are NOT overridden.
function loadEnv(dir) {
  const envFile = path.join(dir || path.join(__dirname, ".."), ".env");
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, "utf8").split("\n").forEach(line => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    const eq  = clean.indexOf("=");
    if (eq === -1) return;
    const key = clean.slice(0, eq).trim();
    const val = clean.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  });
}

// ── Profile resolver ─────────────────────────────────────────────────────────
// Returns the array of profiles to process for a given run.
// Priority: --search <key>  >  --searches <k1,k2>  >  all enabled in config
function resolveProfiles(CFG, args) {
  const getArg  = (flag) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : ""; };
  const single  = getArg("--search");
  const multi   = getArg("--searches");

  const all = CFG.searches;
  let keys;

  if (single) {
    keys = [single];
  } else if (multi) {
    keys = multi.split(",").map(k => k.trim());
  } else {
    keys = Object.keys(all).filter(k => all[k].enabled !== false);
  }

  return keys.map(key => {
    if (!all[key]) {
      console.error(`❌  Unknown search key "${key}". Available: ${Object.keys(all).join(", ")}`);
      process.exit(1);
    }
    return { key, ...all[key] };
  });
}

// ── Slug helper ───────────────────────────────────────────────────────────────
function toSlug(name) {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

// ── Timing ────────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Gaussian-shaped random delay (Box-Muller). Harder to fingerprint than uniform.
function humanDelay({ center, spread, min, max }) {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round(center + z * spread);
  return delay(Math.max(min, Math.min(max, ms)));
}

// ── Nominatim geocoder ────────────────────────────────────────────────────────
function geocode(query, userAgent) {
  return new Promise((resolve, reject) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=pl`;
    const req = https.get(url, { headers: { "User-Agent": userAgent } }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try {
          const results = JSON.parse(body);
          if (!results.length) return reject(new Error(`Geocoding: no results for "${query}"`));
          const { lat, lon, display_name } = results[0];
          resolve({ lat: parseFloat(lat), lon: parseFloat(lon), display_name });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
  });
}

// ── Salary parser ─────────────────────────────────────────────────────────────
// Returns average monthly PLN (integer) or null.
// Handles: "5 000–7 000 zł brutto / mies." and "31,40 zł brutto / godz."
function parseSalary(salary) {
  if (!salary) return null;
  const numericPart = salary.split("zł")[0];
  const parts = numericPart.split(/[–-]/).map(s => s.trim()).filter(Boolean);
  const parseNum = s => {
    const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return isNaN(v) ? null : v;
  };
  const nums = parts.map(parseNum).filter(v => v !== null && v > 0);
  if (!nums.length) return null;
  const avg = (nums[0] + (nums[1] ?? nums[0])) / 2;
  let isHourly;
  if (avg < 1000)      isHourly = true;
  else if (avg > 4000) isHourly = false;
  else                 isHourly = salary.includes("godz");
  return Math.round(isHourly ? avg * 160 : avg);
}

// ── Position level classifier ─────────────────────────────────────────────────
// Returns: "manager" | "specialist" | "worker" | null
function classifyPositionLevel(positionLevels) {
  if (!positionLevels?.length) return null;
  for (const level of positionLevels) {
    const l = level.toLowerCase();
    if (l.includes("dyrektor") || l.includes("menedżer") ||
        l.includes("kierownik") || l.includes("koordynator")) return "manager";
  }
  for (const level of positionLevels) {
    const l = level.toLowerCase();
    if (l.includes("specjalista") || l.includes("ekspert") ||
        l.includes("junior") || l.includes("senior") || l.includes("mid")) return "specialist";
  }
  return "worker";
}

// ── Output path helpers ───────────────────────────────────────────────────────
// outputDir(CFG, profile) → absolute path to output/<slug>/
function outputDir(CFG, profile) {
  const slug = profile.outputSlug || toSlug(profile.label || profile.key);
  return path.resolve(path.join(__dirname, ".."), CFG.output.dir, slug);
}

// rawDir(CFG, profile) → output/<slug>/raw/
function rawDir(CFG, profile) {
  return path.join(outputDir(CFG, profile), "raw");
}

// latestRawFile(CFG, profile) → most recent raw/<timestamp>.json, or null
function latestRawFile(CFG, profile) {
  const dir = rawDir(CFG, profile);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort();  // ISO timestamps sort lexicographically = chronologically
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

module.exports = {
  loadEnv,
  resolveProfiles,
  toSlug,
  delay,
  humanDelay,
  geocode,
  parseSalary,
  classifyPositionLevel,
  outputDir,
  rawDir,
  latestRawFile,
};
