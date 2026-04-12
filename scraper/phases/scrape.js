#!/usr/bin/env node
/**
 * phases/scrape.js  —  Phase 1: scrape only
 * ──────────────────────────────────────────
 * Launches Puppeteer, navigates pracuj.pl, extracts raw listings.
 * Writes output/<slug>/raw/<timestamp>.json  — full unprocessed data.
 *
 * Does NOT: parse salary, classify job level, write .js, touch S3.
 *
 * Usage:
 *   node phases/scrape.js                    # all enabled profiles
 *   node phases/scrape.js --search 03        # one profile
 *   node phases/scrape.js --searches 01,03   # specific profiles
 *   node phases/scrape.js --visible          # show browser window
 */

"use strict";

const path  = require("path");
const fs    = require("fs");
const https = require("https");

const lib = require("./lib");
lib.loadEnv(path.join(__dirname, ".."));

const puppeteer     = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const CFG  = require("../scraper.config.js");
const args = process.argv.slice(2);

const HEADLESS  = !args.includes("--visible");
const profiles  = lib.resolveProfiles(CFG, args);

// ── URL builder ───────────────────────────────────────────────────────────────
async function buildUrl(profile) {
  const params = new URLSearchParams();
  const salaryOnly = profile.salaryOnly ?? CFG.salaryOnly;
  if (salaryOnly)             params.set("sal", "1");
  if (profile.keyword)        params.set("q",   profile.keyword);
  if (profile.category)       params.set("cc",  profile.category);
  if (profile.contractType)   params.set("ct",  profile.contractType);
  if (profile.workMode)       params.set("wm",  profile.workMode);

  if (profile.location) {
    process.stdout.write(`  📍  Geocoding "${profile.location}" ... `);
    const geo = await lib.geocode(profile.location, CFG.geocoder.userAgent);
    const lat = geo.lat, lon = geo.lon;
    console.log(`→ ${geo.display_name.split(",").slice(0, 3).join(",")} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    params.set("wp",        profile.location);
    params.set("rd",        String(profile.radius ?? CFG.defaultRadius));
    params.set("latitude",  String(lat));
    params.set("longitude", String(lon));
  }

  const qs = params.toString();
  return qs ? `${CFG.baseUrl}?${qs}` : CFG.baseUrl;
}

// ── Wait for __NEXT_DATA__ (replaces networkidle2) ────────────────────────────
async function waitForNextData(page, timeoutMs = 20000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return false;
      try { return !!JSON.parse(el.textContent)?.props; } catch (_) { return false; }
    },
    { timeout: timeoutMs }
  );
}

// ── Scroll simulation ─────────────────────────────────────────────────────────
async function simulateScroll(page) {
  await page.evaluate(() => new Promise(resolve => {
    let step = 0;
    const steps = [250, 550, 900];
    function next() {
      if (step >= steps.length) { resolve(); return; }
      window.scrollTo({ top: steps[step++], behavior: "smooth" });
      setTimeout(next, 300 + Math.random() * 200);
    }
    next();
  }));
  await lib.delay(CFG.timing.scrollPause);
}

// ── In-page extractor (raw — no transforms applied here) ─────────────────────
function extractListings() {
  const nextEl = document.getElementById("__NEXT_DATA__");
  if (nextEl) {
    try {
      const data    = JSON.parse(nextEl.textContent);
      const queries = data.props?.pageProps?.dehydratedState?.queries || [];
      for (const q of queries) {
        const go = q.state?.data?.groupedOffers;
        if (!go?.length) continue;
        const results = [];
        go.forEach(g => {
          const { offers, ...groupFields } = g;
          (offers?.length ? offers : [{}]).forEach(o => {
            const rawUrl  = (o.offerAbsoluteUri || "").split("?")[0];
            const idMatch = rawUrl.match(/,oferta,(\d+)/);
            // Spread ALL fields from group (g) and offer (o) — nothing dropped.
            // Named keys on top normalise the most important ones to predictable names.
            results.push({
              ...groupFields,
              ...o,
              // normalised / derived
              id:          idMatch ? idMatch[1] : String(o.partitionId || g.groupId),
              title:       g.jobTitle          || null,
              company:     g.companyName       || null,
              salary:      g.salaryDisplayText || null,
              location:    o.displayWorkplace  || null,
              description: g.jobDescription    || null,
              url:         rawUrl,
            });
          });
        });
        return results;
      }
    } catch (_) {}
  }
  // DOM fallback
  const results = [];
  const section = document.querySelector('[data-test="section-offers"]');
  if (!section) return results;
  section.querySelectorAll('[data-test="default-offer"],[data-test="featured-offer"]').forEach(card => {
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
    const wm = card.querySelectorAll('[data-test="text-work-modes"] li,[data-test="work-modes"] li');
    results.push({
      id,
      title:           t  ? t.innerText.trim()  : null,
      company:         co ? co.innerText.trim() : null,
      companyId:       null, location: lo ? lo.innerText.trim() : null,
      isWholePoland:   null, salary:   sa ? sa.innerText.trim() : null,
      workModes:       wm.length ? Array.from(wm).map(e => e.innerText.trim()) : [],
      workSchedules: [], typesOfContract: [], positionLevels: [],
      isRemote: null, isSuperOffer: null, isOptionalCv: null, isOneClickApply: null,
      publishedAt: da ? da.innerText.trim() : null,
      expiresAt: null, description: null, url: rawUrl,
    });
  });
  return results;
}

// ── Scrape one profile ────────────────────────────────────────────────────────
async function scrapeProfile(profile) {
  const pages     = profile.pages ?? CFG.defaultPages;
  const baseUrl   = await buildUrl(profile);
  const slug      = profile.outputSlug || lib.toSlug(profile.label || profile.key);
  const rawDirPath = lib.rawDir(CFG, profile);
  fs.mkdirSync(rawDirPath, { recursive: true });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔑  [${profile.key}] ${profile.label}  —  ${pages} page(s)`);
  console.log(`   url: ${baseUrl}`);
  console.log(`${"─".repeat(60)}\n`);

  // Profile dir persists cookies/CF clearance across runs
  const profileDir = path.resolve(path.join(__dirname, ".."), CFG.browser.profileDir);
  fs.mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless:    HEADLESS,
    userDataDir: profileDir,
    args: [
      ...CFG.browser.launchArgs,
      ...(process.env.SCRAPER_PROXY_URL ? [`--proxy-server=${process.env.SCRAPER_PROXY_URL}`] : []),
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(CFG.browser.userAgent);
  await page.setExtraHTTPHeaders(CFG.browser.extraHeaders);
  await page.setViewport(CFG.browser.viewport);

  // Warm-up
  console.log("  🌐  Warm-up: visiting pracuj.pl homepage ...");
  try {
    await page.goto("https://www.pracuj.pl", { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      const btn = await page.$('[data-test="button-submitCookie"],#onetrust-accept-btn-handler');
      if (btn) { await btn.click(); await lib.delay(600); }
    } catch (_) {}
    const warmMs = CFG.timing.warmupMin + Math.floor(Math.random() * CFG.timing.warmupJitter);
    console.log(`  ⏳  Idling ${(warmMs/1000).toFixed(1)}s ...\n`);
    await lib.delay(warmMs);
  } catch (err) {
    console.warn(`  ⚠   Warm-up failed (${err.message}), continuing`);
  }

  const allListings = [];
  const errors      = [];
  const seen        = new Set();

  const pagedUrl = (base, n) => { const u = new URL(base); u.searchParams.set("pn", String(n)); return u.toString(); };

  // Page 1
  process.stdout.write(`  Page 1/${pages}  ${baseUrl} ... `);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForNextData(page);
    await simulateScroll(page);
    await lib.delay(CFG.timing.renderWait);
    const listings = await page.evaluate(extractListings);
    listings.forEach(l => { if (!seen.has(l.id)) { seen.add(l.id); allListings.push(l); } });
    console.log(`✅  ${listings.length} listings  (${allListings.length} total)`);
  } catch (err) {
    console.log(`❌  ${err.message}`);
    errors.push({ page: 1, error: err.message });
  }

  // Pages 2+
  for (let p = 2; p <= pages; p++) {
    const url = pagedUrl(baseUrl, p);
    process.stdout.write(`  Page ${p}/${pages}  ${url} ... `);
    await lib.humanDelay({ center: CFG.timing.interPageCenter, spread: CFG.timing.interPageSpread, min: CFG.timing.interPageMin, max: CFG.timing.interPageMax });
    try {
      const clicked = await page.evaluate(target => {
        const btn =
          document.querySelector('[data-test="bottom-pagination-button-next"]') ||
          document.querySelector('a[aria-label="Następna strona"]')             ||
          document.querySelector('a[aria-label="Next page"]')                   ||
          Array.from(document.querySelectorAll('a[href*="pn="]')).find(a => new URL(a.href).searchParams.get("pn") === String(target));
        if (btn) { btn.click(); return true; }
        return false;
      }, p);
      if (!clicked) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      else          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForNextData(page);
      await simulateScroll(page);
      await lib.delay(CFG.timing.renderWait);
      if (!await page.evaluate(() => !!document.querySelector('[data-test="section-offers"]')))
        throw new Error("section-offers not found — possible Cloudflare challenge");
      const listings = await page.evaluate(extractListings);
      const fresh = listings.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
      allListings.push(...fresh);
      console.log(`✅  ${fresh.length} listings  (${allListings.length} total)`);
    } catch (err) {
      console.log(`❌  ${err.message}`);
      errors.push({ page: p, error: err.message });
    }
  }

  // Enrich
  if (profile.enrich && allListings.length) {
    console.log(`\n🏷   Enriching ${allListings.length} listings...\n`);
    for (let i = 0; i < allListings.length; i++) {
      const l = allListings[i];
      if (!l.url) continue;
      process.stdout.write(`  [${i+1}/${allListings.length}] ${l.url.split("/").pop()} ... `);
      await lib.delay(CFG.timing.enrichMin + Math.random() * CFG.timing.enrichJitter);
      try {
        await page.goto(l.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await waitForNextData(page);
        await lib.delay(2000);
        const cats = await page.evaluate(() => {
          const el = document.getElementById("__NEXT_DATA__");
          if (!el) return null;
          for (const q of (JSON.parse(el.textContent).props?.pageProps?.dehydratedState?.queries || [])) {
            const c = q.state?.data?.attributes?.categories;
            if (c?.length) return c;
          }
          return null;
        });
        l.categories = cats
          ? cats.map(c => ({ id: c.id, name: c.name, parentId: c.parent?.id || null, parentName: c.parent?.name || null }))
          : [];
        console.log(cats ? `✅  ${cats.map(c => c.name).join(" / ")}` : "—");
      } catch (err) {
        l.categories = [];
        console.log(`❌  ${err.message.slice(0, 80)}`);
        errors.push({ page: `enrich:${l.id}`, error: err.message });
      }
    }
  }

  await browser.close();

  // Write raw output — full unprocessed data, no transforms
  const scrapedAt = new Date().toISOString();
  const timestamp = scrapedAt.replace(/[:.]/g, "-").replace("Z", "z");
  const raw = {
    meta: {
      profileKey:  profile.key,
      profileLabel: profile.label || profile.key,
      slug,
      source:      baseUrl,
      scrapedAt,
      pages,
      total:       allListings.length,
      errors:      errors.length,
      location:    profile.location || null,
      radius:      profile.location ? (profile.radius ?? CFG.defaultRadius) : null,
      keyword:     profile.keyword  || null,
    },
    listings: allListings,
  };

  const outFile = path.join(rawDirPath, `${timestamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(raw, null, 2), "utf8");
  console.log(`\n✔  Raw data saved → ${outFile}`);
  console.log(`   ${allListings.length} listings  |  ${errors.length} error(s)`);

  if (errors.length) console.warn(`⚠   Errors:`, errors);
  return outFile;
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n📡  Phase 1 — scrape  (${profiles.length} profile(s))\n`);
  for (const profile of profiles) {
    await scrapeProfile(profile);
    if (profiles.indexOf(profile) < profiles.length - 1) {
      console.log(`\n😴  Inter-profile gap ...`);
      await lib.humanDelay({ center: CFG.timing.interCityCenter, spread: CFG.timing.interCitySpread, min: CFG.timing.interCityMin, max: CFG.timing.interCityMax });
    }
  }
  console.log("\n✅  Scrape phase complete\n");
})().catch(err => { console.error("Fatal:", err); process.exit(1); });
