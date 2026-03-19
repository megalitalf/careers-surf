#!/usr/bin/env node
/**
 * setup_location.js  –  Interactive helper to set the player's location.
 *
 * Geocodes a place name or postal code via Nominatim (OpenStreetMap, no API key)
 * and saves the result to config.json so that scrape_jobs.js can pick it up
 * automatically without needing --location on every run.
 *
 * Usage:
 *   node setup_location.js "Kamień Pomorski"
 *   node setup_location.js "72-400"
 *   node setup_location.js "Szczecin" --radius 50
 *   node setup_location.js --clear          # remove saved location
 *   node setup_location.js                  # show current saved location
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");

const CONFIG_FILE = path.join(__dirname, "config.json");
const args        = process.argv.slice(2);

// ── Nominatim geocoder (same as in scrape_jobs.js) ───────────────────────────
function geocode(query) {
  return new Promise((resolve, reject) => {
    const q   = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=pl`;
    const req = https.get(url, { headers: { "User-Agent": "job_surfers_scraper/1.0" } }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try {
          const results = JSON.parse(body);
          if (!results.length) return reject(new Error(`No results found for "${query}"`));
          const { lat, lon, display_name } = results[0];
          resolve({ lat: parseFloat(lat), lon: parseFloat(lon), display_name });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
  });
}

// ── Read / write config ───────────────────────────────────────────────────────
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch (_) { return {}; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const hasFlag = (f) => args.includes(f);
  const getArg  = (f, fb) => { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : fb; };

  // Show current
  if (!args.length) {
    const cfg = readConfig();
    if (cfg.location) {
      console.log(`📍  Current location: "${cfg.location.query}" → ${cfg.location.display_name}`);
      console.log(`    lat: ${cfg.location.lat},  lon: ${cfg.location.lon},  radius: ${cfg.location.radius} km`);
    } else {
      console.log("No location saved. Run:  node setup_location.js \"Your City\"");
    }
    return;
  }

  // Clear
  if (hasFlag("--clear")) {
    const cfg = readConfig();
    delete cfg.location;
    writeConfig(cfg);
    console.log("✔  Location cleared from config.json");
    return;
  }

  // Set new location (first non-flag arg)
  const query  = args.find(a => !a.startsWith("--"));
  const radius = parseInt(getArg("--radius", "30"), 10);

  if (!query) {
    console.error("Usage: node setup_location.js <place or postcode> [--radius <km>]");
    process.exit(1);
  }

  process.stdout.write(`📍  Geocoding "${query}" ... `);
  const geo = await geocode(query);
  const short = geo.display_name.split(",").slice(0, 3).join(",").trim();
  console.log(`→ ${short} (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)})`);

  const cfg = readConfig();
  cfg.location = {
    query,
    display_name: short,
    lat:    geo.lat,
    lon:    geo.lon,
    radius,
  };
  writeConfig(cfg);
  console.log(`✔  Saved to config.json  (radius: ${radius} km)`);
  console.log(`   Run "node scrape_jobs.js" to fetch nearby jobs.`);
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
