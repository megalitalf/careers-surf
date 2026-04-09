#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');

// Files to copy flat into dist/
const FILES = [
  'index.html',
  'common.css',
  'common.js',
  'game.config.js',
  'game.session.js',
  'game.road.js',
  'game.cars.js',
  'game.ui.js',
  'game.input.js',
  'game.js',
  'stats.js',
];

const IMAGE_FILES = [
  'images/background.js',
  'images/sprites.js',
  'images/mute.png',
];

const IMAGE_DIRS = [
  'images/sprites',
  'images/background',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`  copied: ${path.relative(__dirname, dest)}`);
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }
}

// 1. Clean dist
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
ensureDir(DIST);

// 2. Generate jobs.js from jobs.json
const jobsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'jobs.json'), 'utf8'));
const jobsJs = `var jobs = ${JSON.stringify(jobsJson.listings ?? jobsJson, null, 2)};\n`;
fs.writeFileSync(path.join(DIST, 'jobs.js'), jobsJs);
console.log('  generated: jobs.js');

// 3. Copy static files
for (const file of [...FILES, ...IMAGE_FILES]) {
  copyFile(path.join(__dirname, file), path.join(DIST, file));
}

// 4. Copy image directories
for (const dir of IMAGE_DIRS) {
  copyDir(path.join(__dirname, dir), path.join(DIST, dir));
}

console.log('\nBuild complete → dist/');
