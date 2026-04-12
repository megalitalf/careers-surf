/**
 * scraper.config.js
 * ─────────────────
 * Single source of truth for all scraper tunables.
 * CLI flags and env vars always take precedence over these defaults.
 *
 * Edit here — never hardcode values in scrape_jobs.js or run-cities.js.
 */

module.exports = {

  // ── Target ──────────────────────────────────────────────────────────────────
  baseUrl:    "https://www.pracuj.pl/praca",
  salaryOnly: true,           // adds ?sal=1 — pass --no-salary to disable

  // ── Cities to scrape in a full run (node run-cities.js) ────────────────────
  // Each entry becomes --city <name>.  Per-city overrides are supported:
  //   { name: "Szczecin", pages: 2, radius: 50 }
  cities: [
    { name: "Warsaw",   pages: 1, radius: 30 },
    { name: "Krakow",   pages: 1, radius: 30 },
    { name: "Szczecin", pages: 1, radius: 30 },
  ],

  // ── Paging ──────────────────────────────────────────────────────────────────
  defaultPages:  1,           // --pages default
  defaultRadius: 30,          // --radius default (km)

  // ── Timing — all values in milliseconds ─────────────────────────────────────
  timing: {
    // After navigation settles: wait for JS-rendered content to appear
    renderWait:       3500,

    // Warm-up idle on pracuj.pl homepage before going to search
    // Range: warmupMin … warmupMin + warmupJitter  (randomised per run)
    warmupMin:        4000,
    warmupJitter:     5000,   // up to +5 s extra

    // Scroll pause — after simulated scroll, before extracting listings
    scrollPause:       800,

    // Between pages 2+: human reading time before clicking "Next"
    // Uses a Gaussian-shaped spread: center ± spread, clamped to [min, max]
    interPageCenter:  12000,  // 12 s average
    interPageSpread:   4000,  // ± 4 s std-dev approximation
    interPageMin:      7000,  // never faster than 7 s
    interPageMax:     22000,  // never slower than 22 s

    // Between cities inside run-cities.js
    // Same Gaussian approach
    interCityCenter:  90000,  // 90 s average
    interCitySpread:  30000,
    interCityMin:     45000,
    interCityMax:    180000,

    // Enrich: delay between fetching individual job detail pages
    enrichMin:        1800,
    enrichJitter:     1200,
  },

  // ── Browser ──────────────────────────────────────────────────────────────────
  browser: {
    // Chromium user-data-dir for session/cookie persistence across cron runs.
    // Relative to the scraper/ directory; will be created automatically.
    profileDir: "./profile",

    // Fixed UA — same machine every time = more human than rotating
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",

    // Fixed viewport — same machine, same screen
    viewport: { width: 1366, height: 768 },

    // Extra HTTP headers sent on every request
    extraHeaders: {
      "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.5,en;q=0.3",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },

    // Chromium launch flags
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--lang=pl-PL",
      "--disable-blink-features=AutomationControlled",
    ],
  },

  // ── Output ───────────────────────────────────────────────────────────────────
  citiesDir:  "../cities",    // relative to scraper/; same folder as before
  flatOutFile: "../jobs.json",

  // ── S3 ───────────────────────────────────────────────────────────────────────
  s3: {
    region:      process.env.AWS_REGION  || "eu-north-1",
    bucket:      process.env.S3_BUCKET   || "",
    jobsPrefix:  process.env.S3_PREFIX   || "jobs",
    citiesPrefix: "cities",
    cacheControl: "max-age=300",
  },

  // ── Geocoding ────────────────────────────────────────────────────────────────
  geocoder: {
    userAgent: "careers_surf_scraper/2.0 (github.com/megalitalf)",
    url:       "https://nominatim.openstreetmap.org/search",
  },

  // ── Run-cities orchestrator ───────────────────────────────────────────────
  orchestrator: {
    lockFile:  "./scraper.lock",   // relative to scraper/
    logFile:   "./scraper.log",    // JSONL run history
  },
};
