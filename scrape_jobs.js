#!/usr/bin/env node

/**
 * scrape_jobs.js  –  Scrapes job listings from pracuj.pl using a real browser
 * (Puppeteer + stealth) to bypass Cloudflare protection.
 *
 * Navigates by clicking the "Next page" button (mimics real user behaviour)
 * which keeps the Cloudflare session token valid across multiple pages.
 *
 * Usage:
 *   node scrape_jobs.js                        # 1 page (default), saves jobs.json
 *   node scrape_jobs.js --pages 5              # scrape up to 5 pages
 *   node scrape_jobs.js --pages 5 --out custom.json
 *   node scrape_jobs.js --pages 5 --visible    # show the browser window (debug)
 *   node scrape_jobs.js --no-salary             # include listings without salary
 *   node scrape_jobs.js --enrich                 # fetch each detail page to add job categories
 *   node scrape_jobs.js --pages 3 --enrich        # combine flags freely
 *   node scrape_jobs.js --location "Kamień Pomorski" --radius 30
 *   node scrape_jobs.js --location "72-400"        # postal code also works
 *
 * Location flags:
 *   --location <name|postcode>  Filter jobs near this place (geocoded via Nominatim/OSM)
 *   --radius   <km>             Search radius in km (default: 30)
 *
 * Config (edit below):
 *   SALARY_ONLY  – default true  → adds ?sal=1 filter (only listings with salary)
 *                  set to false or pass --no-salary to disable
 */

const puppeteer     = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, fallback) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const hasFlag = (flag) => args.includes(flag);

const TOTAL_PAGES  = parseInt(getArg("--pages", "1"), 10);
const OUT_FILE     = getArg("--out", path.join(__dirname, "jobs.json"));
const HEADLESS     = !hasFlag("--visible");
const ENRICH       = hasFlag("--enrich");
const S3_BUCKET    = getArg("--s3-bucket", process.env.S3_BUCKET || "");
const S3_PREFIX    = getArg("--s3-prefix", process.env.S3_PREFIX || "jobs");
const S3_REGION    = process.env.AWS_REGION || "eu-north-1";
const _locArg      = getArg("--location", "");
const _radiusArg   = getArg("--radius", "");

// Fall back to config.json if --location not provided on CLI
const _config      = (() => { try { return JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "config.json"), "utf8")); } catch(_) { return {}; } })();
const LOCATION     = _locArg  || _config.location?.query  || "";
const RADIUS       = _radiusArg ? parseInt(_radiusArg, 10) : (_config.location?.radius ?? 30);

// ── Config ────────────────────────────────────────────────────────────────────
// Only show listings that include a salary. Adds ?sal=1 to every request.
// Set to false here, or pass --no-salary on the CLI, to include all listings.
const SALARY_ONLY  = !hasFlag("--no-salary") && true;

const _base       = "https://www.pracuj.pl/praca";
const RENDER_WAIT = 3500;   // ms to wait for JS content after navigation

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Nominatim geocoding (OpenStreetMap, no API key needed) ───────────────────
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
          if (!results.length) return reject(new Error(`Geocoding: no results for "${query}"`));
          const { lat, lon, display_name } = results[0];
          resolve({ lat: parseFloat(lat), lon: parseFloat(lon), display_name });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
  });
}

// ── Build the base URL (resolves location if provided) ───────────────────────
async function buildBaseUrl() {
  const params = new URLSearchParams();
  if (SALARY_ONLY) params.set("sal", "1");

  if (LOCATION) {
    // If config.json already has resolved coords for this query, reuse them
    const cached = _config.location?.query === LOCATION ? _config.location : null;
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
  return qs ? `${_base}?${qs}` : _base;
}

// ── Build a paged URL keeping all filter params intact ───────────────────────
function pagedUrl(base, pageNum) {
  const url = new URL(base);
  url.searchParams.set("pn", String(pageNum));
  return url.toString();
}

// ── In-page extractor — reads rich data from __NEXT_DATA__ ───────────────────
// Falls back to DOM scraping if __NEXT_DATA__ is unavailable.
function extractListings() {
  // ── Primary: __NEXT_DATA__ (richer metadata) ────────────────────────────
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
          // a groupedOffer may span multiple locations — one entry per inner offer
          const innerOffers = g.offers && g.offers.length > 0 ? g.offers : [{}];
          innerOffers.forEach((o) => {
            const rawUrl  = (o.offerAbsoluteUri || "").split("?")[0];
            const idMatch = rawUrl.match(/,oferta,(\d+)/);
            const id      = idMatch ? idMatch[1] : String(o.partitionId || g.groupId);

            results.push({
              id,
              title:            g.jobTitle         || null,
              company:          g.companyName       || null,
              companyId:        g.companyId         || null,
              location:         o.displayWorkplace  || null,
              isWholePoland:    o.isWholePoland      || false,
              salary:           g.salaryDisplayText || null,
              workModes:        g.workModes         || [],
              workSchedules:    g.workSchedules     || [],
              typesOfContract:  g.typesOfContract   || [],
              positionLevels:   g.positionLevels    || [],
              isRemote:         g.isRemoteWorkAllowed || false,
              isSuperOffer:     g.isSuperOffer       || false,
              isOptionalCv:     g.isOptionalCv       || false,
              isOneClickApply:  g.isOneClickApply    || false,
              publishedAt:      g.lastPublicated     || null,
              expiresAt:        g.expirationDate     || null,
              description:      g.jobDescription     || null,
              url:              rawUrl,
            });
          });
        });
        return results;
      }
    } catch (_) { /* fall through to DOM */ }
  }

  // ── Fallback: DOM scraping ───────────────────────────────────────────────
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const BASE_URL = await buildBaseUrl();
  const locationLabel = LOCATION ? `${LOCATION} ±${RADIUS}km` : "whole Poland";
  console.log(`\n🔍  Scraping pracuj.pl — up to ${TOTAL_PAGES} page(s)  [headless: ${HEADLESS}]  [salary: ${SALARY_ONLY}]  [location: ${locationLabel}]  [enrich: ${ENRICH}]\n`);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--lang=pl-PL"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "pl-PL,pl;q=0.9" });
  await page.setViewport({ width: 1280, height: 900 });

  const allListings = [];
  const errors      = [];
  const seen        = new Set();

  // ── Load page 1 ────────────────────────────────────────────────────────────
  process.stdout.write(`  Page 1/${TOTAL_PAGES}  ${BASE_URL} ... `);
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 45000 });

    // Dismiss GDPR / cookie consent if present
    try {
      const consentBtn = await page.$('[data-test="button-submitCookie"], #onetrust-accept-btn-handler');
      if (consentBtn) { await consentBtn.click(); await delay(500); }
    } catch (_) {}

    await delay(RENDER_WAIT);

    const listings = await page.evaluate(extractListings);
    listings.forEach(l => { if (!seen.has(l.id)) { seen.add(l.id); allListings.push(l); } });
    console.log(`✅  ${listings.length} listings  (${allListings.length} total)`);
  } catch (err) {
    console.log(`❌  ${err.message}`);
    errors.push({ page: 1, url: BASE_URL, error: err.message });
  }

  // ── Pages 2+ — click the "Next" button to stay in the same session ─────────
  for (let pageNum = 2; pageNum <= TOTAL_PAGES; pageNum++) {
    const url = pagedUrl(BASE_URL, pageNum);
    process.stdout.write(`  Page ${pageNum}/${TOTAL_PAGES}  ${url} ... `);

    // Polite delay before each navigation
    await delay(1500 + Math.random() * 1000);

    try {
      // Find and click the "next page" link/button
      const clicked = await page.evaluate((targetPage) => {
        // pracuj.pl pagination: <a data-test="bottom-pagination-button-next"> or aria-label="Następna"
        const nextBtn =
          document.querySelector('[data-test="bottom-pagination-button-next"]') ||
          document.querySelector('a[aria-label="Następna strona"]') ||
          document.querySelector('a[aria-label="Next page"]') ||
          Array.from(document.querySelectorAll('a[href*="pn="]'))
            .find(a => new URL(a.href).searchParams.get("pn") === String(targetPage));
        if (nextBtn) { nextBtn.click(); return true; }
        return false;
      }, pageNum);

      if (!clicked) {
        // Fallback: direct navigation
        await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      } else {
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 });
      }

      await delay(RENDER_WAIT);

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

  // ── Enrich: fetch each detail page for categories ─────────────────────────
  if (ENRICH && allListings.length > 0) {
    console.log(`\n🏷   Enriching ${allListings.length} listings with category data...\n`);
    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];
      if (!listing.url) continue;
      process.stdout.write(`  [${i + 1}/${allListings.length}] ${listing.url.split("/").pop()} ... `);
      await delay(1200 + Math.random() * 800);
      try {
        await page.goto(listing.url, { waitUntil: "networkidle2", timeout: 45000 });
        await delay(2000);
        const cats = await page.evaluate(() => {
          const el = document.getElementById("__NEXT_DATA__");
          if (!el) return null;
          const data    = JSON.parse(el.textContent);
          const queries = data.props?.pageProps?.dehydratedState?.queries || [];
          for (const q of queries) {
            const cats = q.state?.data?.attributes?.categories;
            if (cats && cats.length > 0) return cats;
          }
          return null;
        });
        if (cats) {
          listing.categories = cats.map(c => ({
            id:         c.id,
            name:       c.name,
            parentId:   c.parent?.id   || null,
            parentName: c.parent?.name || null,
          }));
          console.log(`✅  ${cats.map(c => c.name).join(" / ")}`);
        } else {
          listing.categories = [];
          console.log(`—  (no categories found)`);
        }
      } catch (err) {
        listing.categories = [];
        console.log(`❌  ${err.message.slice(0, 80)}`);
        errors.push({ page: `enrich:${listing.id}`, url: listing.url, error: err.message });
      }
    }
  }

  await browser.close();

  const output = {
    meta: {
      source:    BASE_URL,
      scrapedAt: new Date().toISOString(),
      pages:     TOTAL_PAGES,
      total:     allListings.length,
      errors:    errors.length,
      location:  LOCATION || null,
      radius:    LOCATION ? RADIUS : null,
    },
    listings: allListings,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n✔  Saved ${allListings.length} listings → ${OUT_FILE}`);

  // Also write jobs.js so index.html can load it directly without a server.
  // Exposes a global `var jobs = [...]` containing only the fields the game needs.
  const jsListings = allListings
    .filter(l => l.title && l.url)
    .map(l => ({
      title:    l.title,
      salary:   l.salary   || null,
      company:  l.company  || null,
      location: l.location || (l.isWholePoland ? "Cała Polska" : null),
      url:      l.url,
    }));
  const jsFile = OUT_FILE.replace(/\.json$/, ".js");
  fs.writeFileSync(
    jsFile,
    `// Auto-generated by scrape_jobs.js — do not edit manually.\n// Scraped: ${output.meta.scrapedAt}\nvar jobs = ${JSON.stringify(jsListings, null, 2)};\n`,
    "utf8"
  );
  console.log(`✔  Saved ${jsListings.length} listings → ${jsFile}`);

  // ── Upload to S3 if --s3-bucket / S3_BUCKET is set ───────────────────────
  if (S3_BUCKET) {
    const s3 = new S3Client({ region: S3_REGION });
    const uploads = [
      {
        key:  `${S3_PREFIX}/jobs.json`,
        body: JSON.stringify(output, null, 2),
        type: "application/json",
      },
      {
        key:  `${S3_PREFIX}/jobs.js`,
        body: fs.readFileSync(jsFile, "utf8"),
        type: "application/javascript",
      },
    ];
    for (const { key, body, type } of uploads) {
      process.stdout.write(`  ☁   Uploading s3://${S3_BUCKET}/${key} ... `);
      try {
        await s3.send(new PutObjectCommand({
          Bucket:       S3_BUCKET,
          Key:          key,
          Body:         body,
          ContentType:  type,
          CacheControl: "max-age=300",
        }));
        console.log("✅");
      } catch (err) {
        console.log(`❌  ${err.message}`);
      }
    }
    console.log(`\n✔  S3 upload complete → https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_PREFIX}/jobs.js`);
  }

  if (errors.length) console.warn(`⚠   ${errors.length} page(s) failed:`, errors);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
