#!/usr/bin/env node

/**
 * scraper/scrape_jobs.js  –  Enhanced version of the original scrape_jobs.js.
 *
 * What's new vs the original:
 *   • All tunables live in scraper.config.js — nothing hardcoded here.
 *   • Warm-up: navigates pracuj.pl homepage first, idles like a human.
 *   • waitUntil: "domcontentloaded" + explicit __NEXT_DATA__ poll
 *     instead of "networkidle2" (a well-known automation signal).
 *   • Scroll simulation before extracting listings on every page.
 *   • Inter-page delay raised to human reading pace (Gaussian spread, 7–22 s).
 *   • Session persistence via --user-data-dir (reuses Cloudflare clearance
 *     cookie across cron runs — no fresh challenge every time).
 *
 * Usage (same flags as original):
 *   node scrape_jobs.js --city Warsaw --pages 3
 *   node scrape_jobs.js --pages 5 --visible
 *   node scrape_jobs.js --no-salary --enrich
 */

const puppeteer     = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const CFG = require("./scraper.config.js");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, fallback) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const hasFlag = (flag) => args.includes(flag);

const TOTAL_PAGES  = parseInt(getArg("--pages",       String(CFG.defaultPages)),  10);
const OUT_FILE     = getArg("--out", path.resolve(__dirname, CFG.flatOutFile));
const HEADLESS     = !hasFlag("--visible");
const ENRICH       = hasFlag("--enrich");
const CITY         = getArg("--city", "");
const CITIES_DIR   = path.resolve(__dirname, getArg("--cities-dir", CFG.citiesDir));
const S3_BUCKET    = getArg("--s3-bucket", CFG.s3.bucket);
const S3_PREFIX    = getArg("--s3-prefix", CFG.s3.jobsPrefix);
const S3_REGION    = CFG.s3.region;
const SALARY_ONLY  = !hasFlag("--no-salary") && CFG.salaryOnly;

const _locArg      = getArg("--location", "");
const _radiusArg   = getArg("--radius", "");

// config.json fallback (same as original — backward compat)
const _jsonConfig  = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")); }
  catch (_) { return {}; }
})();
const LOCATION     = _locArg || CITY || _jsonConfig.location?.query || "";
const RADIUS       = _radiusArg
  ? parseInt(_radiusArg, 10)
  : (_jsonConfig.location?.radius ?? CFG.defaultRadius);

// ── Timing helpers ────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gaussian-ish random delay: center ± spread, clamped to [min, max].
 * Uses Box-Muller transform so the distribution has a natural bell shape
 * rather than a flat uniform range — harder to fingerprint statistically.
 */
function humanDelay({ center, spread, min, max }) {
  // Box-Muller → standard normal
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round(center + z * spread);
  return delay(Math.max(min, Math.min(max, ms)));
}

// ── Nominatim geocoding ───────────────────────────────────────────────────────
function geocode(query) {
  return new Promise((resolve, reject) => {
    const q   = encodeURIComponent(query);
    const url = `${CFG.geocoder.url}?q=${q}&format=json&limit=1&countrycodes=pl`;
    const req = https.get(url, { headers: { "User-Agent": CFG.geocoder.userAgent } }, (res) => {
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

// ── Build the base search URL ─────────────────────────────────────────────────
async function buildBaseUrl() {
  const params = new URLSearchParams();
  if (SALARY_ONLY) params.set("sal", "1");

  if (LOCATION) {
    const cached = _jsonConfig.location?.query === LOCATION ? _jsonConfig.location : null;
    let lat, lon;
    if (cached) {
      ({ lat, lon } = cached);
      console.log(`  📍  Location: "${LOCATION}" (from config — ${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    } else {
      process.stdout.write(`  📍  Geocoding "${LOCATION}" ... `);
      const geo = await geocode(LOCATION);
      lat = geo.lat; lon = geo.lon;
      console.log(`→ ${geo.display_name.split(",").slice(0, 3).join(",")} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    }
    params.set("wp",        LOCATION);
    params.set("rd",        String(RADIUS));
    params.set("latitude",  String(lat));
    params.set("longitude", String(lon));
  }

  const qs = params.toString();
  return qs ? `${CFG.baseUrl}?${qs}` : CFG.baseUrl;
}

// ── Paged URL ─────────────────────────────────────────────────────────────────
function pagedUrl(base, pageNum) {
  const url = new URL(base);
  url.searchParams.set("pn", String(pageNum));
  return url.toString();
}

// ── Wait for __NEXT_DATA__ to be populated (replaces networkidle2) ────────────
async function waitForNextData(page, timeoutMs = 20000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return false;
      try { const d = JSON.parse(el.textContent); return !!d?.props; }
      catch (_) { return false; }
    },
    { timeout: timeoutMs }
  );
}

// ── Simulate a human scrolling down the listing page ─────────────────────────
async function simulateScroll(page) {
  await page.evaluate(() => {
    // Scroll in three steps with small pauses — mimics reading behaviour
    return new Promise((resolve) => {
      let step = 0;
      const steps = [250, 550, 900];
      function next() {
        if (step >= steps.length) { resolve(); return; }
        window.scrollTo({ top: steps[step], behavior: "smooth" });
        step++;
        setTimeout(next, 300 + Math.random() * 200);
      }
      next();
    });
  });
  await delay(CFG.timing.scrollPause);
}

// ── In-page extractor — reads rich data from __NEXT_DATA__ ───────────────────
// Identical to original; kept in one place for easy future updates.
function extractListings() {
  const nextEl = document.getElementById("__NEXT_DATA__");
  if (nextEl) {
    try {
      const data    = JSON.parse(nextEl.textContent);
      const queries = data.props?.pageProps?.dehydratedState?.queries || [];
      let groupedOffers = null;
      for (const q of queries) {
        const go = q.state?.data?.groupedOffers;
        if (go && go.length > 0) { groupedOffers = go; break; }
      }
      if (groupedOffers) {
        const results = [];
        groupedOffers.forEach((g) => {
          const innerOffers = g.offers && g.offers.length > 0 ? g.offers : [{}];
          innerOffers.forEach((o) => {
            const rawUrl  = (o.offerAbsoluteUri || "").split("?")[0];
            const idMatch = rawUrl.match(/,oferta,(\d+)/);
            const id      = idMatch ? idMatch[1] : String(o.partitionId || g.groupId);
            results.push({
              id,
              title:           g.jobTitle          || null,
              company:         g.companyName        || null,
              companyId:       g.companyId          || null,
              location:        o.displayWorkplace   || null,
              isWholePoland:   o.isWholePoland       || false,
              salary:          g.salaryDisplayText  || null,
              workModes:       g.workModes          || [],
              workSchedules:   g.workSchedules      || [],
              typesOfContract: g.typesOfContract    || [],
              positionLevels:  g.positionLevels     || [],
              isRemote:        g.isRemoteWorkAllowed || false,
              isSuperOffer:    g.isSuperOffer        || false,
              isOptionalCv:    g.isOptionalCv        || false,
              isOneClickApply: g.isOneClickApply     || false,
              publishedAt:     g.lastPublicated      || null,
              expiresAt:       g.expirationDate      || null,
              description:     g.jobDescription      || null,
              url:             rawUrl,
            });
          });
        });
        return results;
      }
    } catch (_) { /* fall through */ }
  }

  // DOM fallback
  const results = [];
  const section = document.querySelector('[data-test="section-offers"]');
  if (!section) return results;
  section.querySelectorAll('[data-test="default-offer"], [data-test="featured-offer"]').forEach((card) => {
    const anchor = card.querySelector('a[href*=",oferta,"]');
    if (!anchor) return;
    const rawUrl  = anchor.href.split("?")[0];
    const idMatch = rawUrl.match(/,oferta,(\d+)/);
    const id      = idMatch ? idMatch[1] : null;
    if (!id) return;
    const t  = card.querySelector('[data-test="offer-title"]') || card.querySelector("h2") || anchor;
    const co = card.querySelector('[data-test="text-company-name"]');
    const lo = card.querySelector('[data-test="text-region"]');
    const sa = card.querySelector('[data-test="text-salary"]');
    const da = card.querySelector('[data-test="text-added"]');
    const wm = card.querySelectorAll('[data-test="text-work-modes"] li, [data-test="work-modes"] li');
    results.push({
      id,
      title:           t  ? t.innerText.trim()  : null,
      company:         co ? co.innerText.trim() : null,
      companyId:       null,
      location:        lo ? lo.innerText.trim() : null,
      isWholePoland:   null,
      salary:          sa ? sa.innerText.trim() : null,
      workModes:       wm.length ? Array.from(wm).map(e => e.innerText.trim()) : [],
      workSchedules:   [],
      typesOfContract: [],
      positionLevels:  [],
      isRemote:        null,
      isSuperOffer:    null,
      isOptionalCv:    null,
      isOneClickApply: null,
      publishedAt:     da ? da.innerText.trim() : null,
      expiresAt:       null,
      description:     null,
      url:             rawUrl,
    });
  });
  return results;
}

// ── Salary parser ─────────────────────────────────────────────────────────────
function parseSalary(salary) {
  if (!salary) return null;
  const numericPart = salary.split("zł")[0];
  const parts = numericPart.split(/[–-]/).map(s => s.trim()).filter(Boolean);
  const parseNum = (s) => {
    const v = parseFloat(s.replace(/\s/g, "").replace(",", "."));
    return isNaN(v) ? null : v;
  };
  const nums = parts.map(parseNum).filter(v => v !== null && v > 0);
  if (nums.length === 0) return null;
  const avg = (nums[0] + (nums[1] ?? nums[0])) / 2;
  let isHourly;
  if (avg < 1000)      isHourly = true;
  else if (avg > 4000) isHourly = false;
  else                 isHourly = salary.includes("godz");
  return Math.round(isHourly ? avg * 160 : avg);
}

// ── Position level classifier ─────────────────────────────────────────────────
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

// ── Slug helper ───────────────────────────────────────────────────────────────
function toSlug(name) {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const BASE_URL = await buildBaseUrl();
  const locationLabel = LOCATION ? `${LOCATION} ±${RADIUS}km` : "whole Poland";
  console.log(
    `\n🔍  Scraping pracuj.pl` +
    `  pages=${TOTAL_PAGES}  headless=${HEADLESS}  salary=${SALARY_ONLY}` +
    `  location=${locationLabel}  enrich=${ENRICH}\n`
  );

  // ── Session profile dir — persists cookies/CF clearance across runs ─────────
  const profileDir = path.resolve(__dirname, CFG.browser.profileDir);
  fs.mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless:     HEADLESS,
    userDataDir:  profileDir,   // ← key: reuses cookies between cron runs
    args: [
      ...CFG.browser.launchArgs,
      // Proxy support: set SCRAPER_PROXY_URL env var to enable, e.g.
      //   SCRAPER_PROXY_URL=socks5://user:pass@host:port
      ...(process.env.SCRAPER_PROXY_URL
        ? [`--proxy-server=${process.env.SCRAPER_PROXY_URL}`]
        : []),
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(CFG.browser.userAgent);
  await page.setExtraHTTPHeaders(CFG.browser.extraHeaders);
  await page.setViewport(CFG.browser.viewport);

  // ── Warm-up: visit homepage first, idle, then go to search ─────────────────
  // A real user lands on the homepage before searching — this seeds the
  // Cloudflare session and looks natural.
  console.log("  🌐  Warm-up: visiting pracuj.pl homepage ...");
  try {
    await page.goto("https://www.pracuj.pl", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Dismiss cookie consent on the homepage if it appears
    try {
      const consentBtn = await page.$('[data-test="button-submitCookie"], #onetrust-accept-btn-handler');
      if (consentBtn) {
        console.log("  🍪  Accepting cookie consent ...");
        await consentBtn.click();
        await delay(600);
      }
    } catch (_) {}

    // Idle on homepage — human reading / deciding where to click
    const warmMs = CFG.timing.warmupMin + Math.floor(Math.random() * CFG.timing.warmupJitter);
    console.log(`  ⏳  Idling on homepage for ${(warmMs / 1000).toFixed(1)} s ...\n`);
    await delay(warmMs);
  } catch (err) {
    // Non-fatal — if homepage fails we still try the search
    console.warn(`  ⚠   Warm-up failed (${err.message}), continuing anyway`);
  }

  const allListings = [];
  const errors      = [];
  const seen        = new Set();

  // ── Page 1 ───────────────────────────────────────────────────────────────────
  process.stdout.write(`  Page 1/${TOTAL_PAGES}  ${BASE_URL} ... `);
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForNextData(page);
    await simulateScroll(page);
    await delay(CFG.timing.renderWait);

    const listings = await page.evaluate(extractListings);
    listings.forEach(l => { if (!seen.has(l.id)) { seen.add(l.id); allListings.push(l); } });
    console.log(`✅  ${listings.length} listings  (${allListings.length} total)`);
  } catch (err) {
    console.log(`❌  ${err.message}`);
    errors.push({ page: 1, url: BASE_URL, error: err.message });
  }

  // ── Pages 2+ ─────────────────────────────────────────────────────────────────
  for (let pageNum = 2; pageNum <= TOTAL_PAGES; pageNum++) {
    const url = pagedUrl(BASE_URL, pageNum);
    process.stdout.write(`  Page ${pageNum}/${TOTAL_PAGES}  ${url} ... `);

    // Human reading pace before clicking "Next"
    await humanDelay(CFG.timing.interPage ?? {
      center: CFG.timing.interPageCenter,
      spread: CFG.timing.interPageSpread,
      min:    CFG.timing.interPageMin,
      max:    CFG.timing.interPageMax,
    });

    try {
      const clicked = await page.evaluate((targetPage) => {
        const nextBtn =
          document.querySelector('[data-test="bottom-pagination-button-next"]') ||
          document.querySelector('a[aria-label="Następna strona"]')             ||
          document.querySelector('a[aria-label="Next page"]')                   ||
          Array.from(document.querySelectorAll('a[href*="pn="]'))
            .find(a => new URL(a.href).searchParams.get("pn") === String(targetPage));
        if (nextBtn) { nextBtn.click(); return true; }
        return false;
      }, pageNum);

      if (!clicked) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } else {
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 });
      }

      await waitForNextData(page);
      await simulateScroll(page);
      await delay(CFG.timing.renderWait);

      const hasSection = await page.evaluate(
        () => !!document.querySelector('[data-test="section-offers"]')
      );
      if (!hasSection) throw new Error("section-offers not found — possible Cloudflare challenge");

      const listings = await page.evaluate(extractListings);
      const fresh    = listings.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
      allListings.push(...fresh);
      console.log(`✅  ${fresh.length} listings  (${allListings.length} total)`);
    } catch (err) {
      console.log(`❌  ${err.message}`);
      errors.push({ page: pageNum, url, error: err.message });
    }
  }

  // ── Enrich ────────────────────────────────────────────────────────────────────
  if (ENRICH && allListings.length > 0) {
    console.log(`\n🏷   Enriching ${allListings.length} listings...\n`);
    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];
      if (!listing.url) continue;
      process.stdout.write(`  [${i + 1}/${allListings.length}] ${listing.url.split("/").pop()} ... `);
      await delay(CFG.timing.enrichMin + Math.random() * CFG.timing.enrichJitter);
      try {
        await page.goto(listing.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await waitForNextData(page);
        await delay(2000);
        const cats = await page.evaluate(() => {
          const el = document.getElementById("__NEXT_DATA__");
          if (!el) return null;
          const data = JSON.parse(el.textContent);
          for (const q of (data.props?.pageProps?.dehydratedState?.queries || [])) {
            const cats = q.state?.data?.attributes?.categories;
            if (cats?.length) return cats;
          }
          return null;
        });
        if (cats) {
          listing.categories = cats.map(c => ({
            id: c.id, name: c.name,
            parentId: c.parent?.id || null, parentName: c.parent?.name || null,
          }));
          console.log(`✅  ${cats.map(c => c.name).join(" / ")}`);
        } else {
          listing.categories = [];
          console.log(`—`);
        }
      } catch (err) {
        listing.categories = [];
        console.log(`❌  ${err.message.slice(0, 80)}`);
        errors.push({ page: `enrich:${listing.id}`, url: listing.url, error: err.message });
      }
    }
  }

  await browser.close();

  // ── Build slim listings (shared by city + flat runs) ─────────────────────────
  const jsListings = allListings
    .filter(l => l.title && l.url)
    .map(l => ({
      id:          l.id || null,
      title:       l.title,
      salary:      l.salary      || null,
      salaryAvg:   parseSalary(l.salary),
      company:     l.company     || null,
      location:    l.location    || (l.isWholePoland ? "Cała Polska" : null),
      description: l.description || null,
      url:         l.url,
      jobLevel:    classifyPositionLevel(l.positionLevels),
    }));

  const meta = {
    source:    BASE_URL,
    scrapedAt: new Date().toISOString(),
    pages:     TOTAL_PAGES,
    total:     jsListings.length,
    errors:    errors.length,
    location:  LOCATION || null,
    radius:    LOCATION ? RADIUS : null,
  };

  // ── City run ──────────────────────────────────────────────────────────────────
  if (CITY) {
    const slug      = toSlug(CITY);
    const cityDir   = path.join(CITIES_DIR, slug);
    const timestamp = meta.scrapedAt.replace(/[:.]/g, "-").replace("Z", "z");
    const tsFile    = path.join(cityDir, `${timestamp}.json`);
    const latFile   = path.join(cityDir, "latest.json");
    const tsJsFile  = path.join(cityDir, `${timestamp}.js`);
    const latJsFile = path.join(cityDir, "latest.js");

    fs.mkdirSync(cityDir, { recursive: true });

    const slimOutput = { meta, listings: jsListings };
    const json       = JSON.stringify(slimOutput, null, 2);
    fs.writeFileSync(tsFile,  json, "utf8");
    fs.writeFileSync(latFile, json, "utf8");

    const jsContent = `// Auto-generated by scraper/scrape_jobs.js\n// City: ${CITY}  Scraped: ${meta.scrapedAt}\nvar cityJobs = ${JSON.stringify(jsListings, null, 2)};\n`;
    fs.writeFileSync(tsJsFile,  jsContent, "utf8");
    fs.writeFileSync(latJsFile, jsContent, "utf8");

    console.log(`\n✔  Saved ${jsListings.length} listings → ${tsFile}`);
    console.log(`✔  Updated latest          → ${latFile}`);
    console.log(`✔  Updated latest.js       → ${latJsFile}`);

    // S3 upload for city run
    if (S3_BUCKET) {
      const s3 = new S3Client({ region: S3_REGION });
      const cityPrefix = CFG.s3.citiesPrefix;
      const uploads = [
        { key: `${cityPrefix}/${slug}/${timestamp}.json`, body: json,       type: "application/json" },
        { key: `${cityPrefix}/${slug}/latest.json`,       body: json,       type: "application/json" },
        { key: `${cityPrefix}/${slug}/${timestamp}.js`,   body: jsContent,  type: "application/javascript" },
        { key: `${cityPrefix}/${slug}/latest.js`,         body: jsContent,  type: "application/javascript" },
      ];
      for (const { key, body, type } of uploads) {
        process.stdout.write(`  ☁   s3://${S3_BUCKET}/${key} ... `);
        try {
          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET, Key: key, Body: body,
            ContentType: type, CacheControl: CFG.s3.cacheControl,
          }));
          console.log("✅");
        } catch (err) { console.log(`❌  ${err.message}`); }
      }
    }

  // ── Flat run ──────────────────────────────────────────────────────────────────
  } else {
    const slimOutput = { meta, listings: jsListings };
    fs.writeFileSync(OUT_FILE, JSON.stringify(slimOutput, null, 2), "utf8");
    const jsFile = OUT_FILE.replace(/\.json$/, ".js");
    fs.writeFileSync(
      jsFile,
      `// Auto-generated by scraper/scrape_jobs.js\n// Scraped: ${meta.scrapedAt}\nvar jobs = ${JSON.stringify(jsListings, null, 2)};\n`,
      "utf8"
    );
    console.log(`\n✔  Saved ${jsListings.length} listings → ${OUT_FILE}`);
    console.log(`✔  Saved ${jsListings.length} listings → ${jsFile}`);

    if (S3_BUCKET) {
      const s3 = new S3Client({ region: S3_REGION });
      const uploads = [
        { key: `${S3_PREFIX}/jobs.json`, body: JSON.stringify(slimOutput, null, 2), type: "application/json" },
        { key: `${S3_PREFIX}/jobs.js`,   body: fs.readFileSync(jsFile, "utf8"),     type: "application/javascript" },
      ];
      for (const { key, body, type } of uploads) {
        process.stdout.write(`  ☁   s3://${S3_BUCKET}/${key} ... `);
        try {
          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET, Key: key, Body: body,
            ContentType: type, CacheControl: CFG.s3.cacheControl,
          }));
          console.log("✅");
        } catch (err) { console.log(`❌  ${err.message}`); }
      }
    }
  }

  if (errors.length) console.warn(`\n⚠   ${errors.length} page(s) had errors:`, errors);

  // Return structured result for run-cities.js orchestrator
  return { city: CITY || null, total: jsListings.length, errors: errors.length, scrapedAt: meta.scrapedAt };
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
