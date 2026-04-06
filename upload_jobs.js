#!/usr/bin/env node
/**
 * upload_jobs.js
 * Uploads the already-generated jobs.json and jobs.js to S3
 * without running the scraper again.
 *
 * Usage:
 *   S3_BUCKET=careers-surf-data node upload_jobs.js
 *   npm run upload
 */

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");

const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_PREFIX = process.env.S3_PREFIX || "jobs";
const S3_REGION = process.env.AWS_REGION || "eu-north-1";

if (!S3_BUCKET) {
  console.error("❌  S3_BUCKET env variable is not set.");
  process.exit(1);
}

const uploads = [
  {
    key:  `${S3_PREFIX}/jobs.json`,
    file: path.join(__dirname, "jobs.json"),
    type: "application/json",
  },
  {
    key:  `${S3_PREFIX}/jobs.js`,
    file: path.join(__dirname, "jobs.js"),
    type: "application/javascript",
  },
];

(async () => {
  const s3 = new S3Client({ region: S3_REGION });

  for (const { key, file, type } of uploads) {
    if (!fs.existsSync(file)) {
      console.error(`❌  File not found: ${file}`);
      process.exit(1);
    }

    process.stdout.write(`  ☁   Uploading s3://${S3_BUCKET}/${key} ... `);
    try {
      await s3.send(new PutObjectCommand({
        Bucket:       S3_BUCKET,
        Key:          key,
        Body:         fs.readFileSync(file, "utf8"),
        ContentType:  type,
        CacheControl: "max-age=300",
      }));
      console.log("✅");
    } catch (err) {
      console.log(`❌  ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✔  S3 upload complete → https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_PREFIX}/jobs.js`);
})();
