#!/usr/bin/env node
/**
 * upload_cities.js
 * Uploads the contents of the local cities/ folder to S3 under cities/<slug>/
 * without running the scraper again.
 *
 * Each city folder is expected to contain:
 *   latest.json, latest.js, <timestamp>.json, <timestamp>.js, ...
 *
 * Usage:
 *   S3_BUCKET=careers-surf-data node upload_cities.js
 *   npm run upload:cities
 *
 *   # Upload a single city only:
 *   S3_BUCKET=careers-surf-data node upload_cities.js --city warsaw
 */

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs   = require("fs");
const path = require("path");

const args      = process.argv.slice(2);
const getArg    = (flag, fallback) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };

const S3_BUCKET    = process.env.S3_BUCKET || "";
const S3_PREFIX    = getArg("--s3-prefix", process.env.S3_PREFIX || "cities");
const S3_REGION    = process.env.AWS_REGION || "eu-north-1";
const CITIES_DIR   = getArg("--cities-dir", path.join(__dirname, "cities"));
const ONLY_CITY    = getArg("--city", "").toLowerCase();  // optional filter

if (!S3_BUCKET) {
  console.error("❌  S3_BUCKET env variable is not set.");
  process.exit(1);
}

if (!fs.existsSync(CITIES_DIR)) {
  console.error(`❌  Cities directory not found: ${CITIES_DIR}`);
  process.exit(1);
}

function contentType(fileName) {
  return fileName.endsWith(".js") ? "application/javascript" : "application/json";
}

// Collect all files to upload: cities/<slug>/<file>
function collectFiles() {
  const files = [];
  for (const slug of fs.readdirSync(CITIES_DIR)) {
    if (ONLY_CITY && slug !== ONLY_CITY) continue;
    const cityDir = path.join(CITIES_DIR, slug);
    if (!fs.statSync(cityDir).isDirectory()) continue;
    for (const file of fs.readdirSync(cityDir)) {
      if (!file.endsWith(".json") && !file.endsWith(".js")) continue;
      files.push({
        localPath: path.join(cityDir, file),
        key:       `${S3_PREFIX}/${slug}/${file}`,
        type:      contentType(file),
      });
    }
  }
  return files;
}

(async () => {
  const files = collectFiles();

  if (!files.length) {
    console.warn("⚠   No files found to upload" + (ONLY_CITY ? ` for city: ${ONLY_CITY}` : "") + ".");
    process.exit(0);
  }

  console.log(`\n☁   Uploading ${files.length} file(s) to s3://${S3_BUCKET}/${S3_PREFIX}/\n`);
  const s3 = new S3Client({ region: S3_REGION });

  for (const { localPath, key, type } of files) {
    process.stdout.write(`  ☁   s3://${S3_BUCKET}/${key} ... `);
    try {
      await s3.send(new PutObjectCommand({
        Bucket:       S3_BUCKET,
        Key:          key,
        Body:         fs.readFileSync(localPath, "utf8"),
        ContentType:  type,
        CacheControl: "max-age=300",
      }));
      console.log("✅");
    } catch (err) {
      console.log(`❌  ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✔  Upload complete → https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_PREFIX}/`);
})();
