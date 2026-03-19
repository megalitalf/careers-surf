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
 */

const puppeteer     = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const fs   = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, fallback) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const hasFlag = (flag) => args.includes(flag);

const TOTAL_PAGES  = parseInt(getArg("--pages", "1"), 10);
const OUT_FILE     = getArg("--out", path.join(__dirname, "jobs.json"));
const HEADLESS     = !hasFlag("--visible");
const BASE_URL     = "https://www.pracuj.pl/praca";
const RENDER_WAIT  = 3500;   // ms to wait for JS content after navigation

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── In-page extractor (runs inside Chromium) ──────────────────────────────────
function extractListings() {
  const results = [];
  const section = document.querySelector('[data-test="section-offers"]');
  if (!section) return results;

  const cards = section.querySelectorAll(
    '[data-test="default-offer"], [data-test="featured-offer"]'
  );

  cards.forEach((card) => {
    const anchor = card.querySelector('a[href*=",oferta,"]');
    if (!anchor) return;
    const rawUrl  = anchor.href.split("?")[0];
    const idMatch = rawUrl.match(/,oferta,(\d+)/);
    const id      = idMatch ? idMatch[1] : null;
    if (!id) return;

    const titleEl    = card.querySelector('[data-test="offer-title"]') || card.querySelector("h2") || anchor;
    const companyEl  = card.querySelector('[data-test="text-company-name"]');
    const locationEl = card.querySelector('[data-test="text-region"]');
    const salaryEl   = card.querySelector('[data-test="text-salary"]');
    const dateEl     = card.querySelector('[data-test="text-added"]');
    const wmEls      = card.querySelectorAll('[data-test="text-work-modes"] li, [data-test="work-modes"] li');

    results.push({
      id,
      title:       titleEl    ? titleEl.innerText.trim()    : null,
      company:     companyEl  ? companyEl.innerText.trim()  : null,
      location:    locationEl ? locationEl.innerText.trim() : null,
      salary:      salaryEl   ? salaryEl.innerText.trim()   : null,
      workMode:    wmEls.length ? Array.from(wmEls).map(el => el.innerText.trim()).join(", ") : null,
      publishedAt: dateEl     ? dateEl.innerText.trim()     : null,
      url:         rawUrl,
    });
  });

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍  Scraping pracuj.pl — up to ${TOTAL_PAGES} page(s)  [headless: ${HEADLESS}]\n`);

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
    const url = `${BASE_URL}?pn=${pageNum}`;
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
          Array.from(document.querySelectorAll('a[href*="?pn="]'))
            .find(a => a.href.includes(`?pn=${targetPage}`));
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

  await browser.close();

  const output = {
    meta: {
      source:    BASE_URL,
      scrapedAt: new Date().toISOString(),
      pages:     TOTAL_PAGES,
      total:     allListings.length,
      errors:    errors.length,
    },
    listings: allListings,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n✔  Saved ${allListings.length} listings → ${OUT_FILE}`);
  if (errors.length) console.warn(`⚠   ${errors.length} page(s) failed:`, errors);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
