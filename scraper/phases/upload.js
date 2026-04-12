#!/usr/bin/env node
/**
 * phases/upload.js  —  Phase 3: upload only
 * ──────────────────────────────────────────
 * Reads output/<slug>/latest.json + latest.js for each profile
 * and pushes them to S3 (plus timestamped copies under cities/<slug>/).
 *
 * Storage target is swappable — add a new target below the S3 block.
 *
 * Does NOT: scrape, normalize, launch a browser.
 *
 * Usage:
 *   node phases/upload.js                    # all enabled profiles
 *   node phases/upload.js --search 03        # one profile
 *   node phases/upload.js --searches 01,03   # specific profiles
 *
 * Env vars (set in scraper/.env or shell):
 *   S3_BUCKET, AWS_REGION, AWS_PROFILE
 */

"use strict";

const path = require("path");
const fs   = require("fs");

const lib = require("./lib");
lib.loadEnv(path.join(__dirname, ".."));

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const CFG      = require("../scraper.config.js");
const args     = process.argv.slice(2);
const profiles = lib.resolveProfiles(CFG, args);

const S3_BUCKET = process.env.S3_BUCKET || CFG.s3.bucket;
const S3_REGION = process.env.AWS_REGION || CFG.s3.region;

if (!S3_BUCKET) {
  console.error("❌  S3_BUCKET is not set. Add it to scraper/.env or pass as env var.");
  process.exit(1);
}

// ── S3 upload helper ──────────────────────────────────────────────────────────
async function s3Put(s3, key, body, contentType) {
  process.stdout.write(`  ☁   s3://${S3_BUCKET}/${key} ... `);
  try {
    await s3.send(new PutObjectCommand({
      Bucket:       S3_BUCKET,
      Key:          key,
      Body:         body,
      ContentType:  contentType,
      CacheControl: CFG.s3.cacheControl,
    }));
    console.log("✅");
    return true;
  } catch (err) {
    console.log(`❌  ${err.message}`);
    return false;
  }
}

// ── Upload one profile ────────────────────────────────────────────────────────
async function uploadProfile(s3, profile) {
  const slug       = profile.outputSlug || lib.toSlug(profile.label || profile.key);
  const outDirPath = lib.outputDir(CFG, profile);

  const latestJson = path.join(outDirPath, "latest.json");
  const latestJs   = path.join(outDirPath, "latest.js");

  if (!fs.existsSync(latestJson) || !fs.existsSync(latestJs)) {
    console.error(`❌  [${profile.key}] Normalized files not found in ${outDirPath}. Run phase 2 (normalize) first.`);
    return false;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔑  [${profile.key}] ${profile.label}  —  uploading`);
  console.log(`${"─".repeat(60)}\n`);

  const jsonBody = fs.readFileSync(latestJson, "utf8");
  const jsBody   = fs.readFileSync(latestJs,   "utf8");

  // Derive timestamp from meta.normalizedAt in the JSON
  let timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "z");
  try {
    const meta = JSON.parse(jsonBody).meta;
    if (meta?.normalizedAt) timestamp = meta.normalizedAt.replace(/[:.]/g, "-").replace("Z", "z");
  } catch (_) {}

  const prefix = CFG.s3.citiesPrefix;

  // Upload latest + timestamped copies
  const uploads = [
    { key: `${prefix}/${slug}/latest.json`,         body: jsonBody, type: "application/json"       },
    { key: `${prefix}/${slug}/latest.js`,           body: jsBody,   type: "application/javascript" },
    { key: `${prefix}/${slug}/${timestamp}.json`,   body: jsonBody, type: "application/json"       },
    { key: `${prefix}/${slug}/${timestamp}.js`,     body: jsBody,   type: "application/javascript" },
  ];

  let ok = 0;
  for (const { key, body, type } of uploads) {
    const success = await s3Put(s3, key, body, type);
    if (success) ok++;
  }

  console.log(`\n  ✔  ${ok}/${uploads.length} files uploaded for [${profile.key}] ${slug}`);
  return ok === uploads.length;
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n☁   Phase 3 — upload  (${profiles.length} profile(s))  →  s3://${S3_BUCKET}\n`);
  const s3 = new S3Client({ region: S3_REGION });

  let ok = 0, fail = 0;
  for (const profile of profiles) {
    const success = await uploadProfile(s3, profile);
    success ? ok++ : fail++;
  }

  console.log(`\n✅  Upload phase complete  (${ok} ok, ${fail} failed)\n`);
  if (fail) process.exit(1);
})().catch(err => { console.error("Fatal:", err); process.exit(1); });
