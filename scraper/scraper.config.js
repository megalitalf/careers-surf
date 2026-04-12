/**
 * scraper.config.js
 * ─────────────────
 * Single source of truth for all scraper tunables.
 * CLI flags always take precedence over these defaults.
 *
 * Edit here — never hardcode values in scrape_jobs.js or run-cities.js.
 *
 * ── How search profiles work ─────────────────────────────────────────────────
 * Each entry in `searches` is a named profile with a short string key.
 * Run a single profile:   node scrape_jobs.js --search 01
 * Run all profiles:       node run-cities.js           (loops every enabled one)
 * Run a subset:           node run-cities.js --searches 01,03
 * Dry-run:                node run-cities.js --dry-run
 *
 * Profile fields (all optional except `label`):
 *   label        Human-readable name shown in logs
 *   location     City name or postcode — geocoded via Nominatim
 *   radius       Search radius in km (default: 30)
 *   keyword      Free-text keyword added to the search URL (?q=...)
 *   category     pracuj.pl category ID or slug (?cc=...)
 *   contractType e.g. "permanent", "b2b" (?ct=...)
 *   workMode     e.g. "remote", "hybrid" (?wm=...)
 *   salaryOnly   true = add ?sal=1 (default: global salaryOnly below)
 *   pages        How many listing pages to scrape (default: 1)
 *   enrich       true = fetch each job detail page for categories
 *   outputSlug   Folder name under cities/  (default: slugified label)
 *   enabled      false = skip in full runs (default: true)
 */

module.exports = {

  // ── Target ──────────────────────────────────────────────────────────────────
  baseUrl:    "https://www.pracuj.pl/praca",
  salaryOnly: true,   // global default — overridable per-profile

  // ── Search profiles ──────────────────────────────────────────────────────────
  searches: {
    // "01": {
    //   label:      "Warsaw – all",
    //   location:   "Warsaw",
    //   radius:     30,
    //   pages:      1,
    //   outputSlug: "warsaw",
    // },
    // "02": {
    //   label:      "Kraków – all",
    //   location:   "Krakow",
    //   radius:     30,
    //   pages:      1,
    //   outputSlug: "krakow",
    // },
    // "03": {
    //   label:      "Szczecin – all",
    //   location:   "Szczecin",
    //   radius:     30,
    //   pages:      1,
    //   outputSlug: "szczecin",
    // },
    "04": {
      label:      "Lodz – all",
      location:   "Lodz",
      radius:     30,
      pages:      1,
      outputSlug: "lodz",
    },
    // ── Keyword / non-location examples (uncomment to activate) ──────────────
    // "04": {
    //   label:      "Remote – IT",
    //   keyword:    "developer",
    //   workMode:   "remote",
    //   salaryOnly: true,
    //   pages:      2,
    //   outputSlug: "remote-it",
    // },
    // "05": {
    //   label:      "Warsaw – Senior React",
    //   location:   "Warsaw",
    //   radius:     20,
    //   keyword:    "react",
    //   pages:      1,
    //   outputSlug: "warsaw-react",
    // },
    // "06": {
    //   label:      "Whole Poland – B2B DevOps",
    //   keyword:    "devops",
    //   contractType: "b2b",
    //   salaryOnly: false,
    //   pages:      3,
    //   outputSlug: "pl-devops-b2b",
    // },
  },

  // ── Defaults (used when a profile doesn't specify the field) ────────────────
  defaultPages:  1,
  defaultRadius: 30,

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
  // Pipeline phases write here.  Structure per profile:
  //   cities/<slug>/raw/<timestamp>.json   ← phase 1 (scrape)
  //   cities/<slug>/latest.json            ← phase 2 (normalize)
  //   cities/<slug>/latest.js             ← phase 2 (normalize)
  output: {
    dir: "../cities",         // relative to scraper/; created automatically
  },

  // Legacy paths — kept for backward compat with old scripts and the UI
  citiesDir:   "../cities",
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
