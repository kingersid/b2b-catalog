#!/usr/bin/env node
// add-from-gphotos.mjs — Add images from a Google Photos share link to the catalog.
//
// Usage:
//   node scripts/add-from-gphotos.mjs <gphotos-link> [--single]
//
//   <gphotos-link>  A Google Photos share URL (photos.app.goo.gl/... or photos.google.com/share/...)
//   --single        Only download the first image (useful for single-photo links)
//
// What it does:
//   1. Fetches the Google Photos page and extracts photo IDs from the HTML
//   2. Downloads full-resolution images (no size suffix = original quality)
//   3. Generates mid/ (1000px) and webp/ (1600px) optimized versions via sharp
//   4. Auto-adds filenames to FILES arrays in index.html, media.js, and functions/share.js
//   5. Verifies portrait orientation

import sharp from "sharp";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    single: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SINGLE = values.single || false;
const RAW_URL = positionals[0];

if (!RAW_URL) {
  console.error("Usage: node scripts/add-from-gphotos.mjs <google-photos-link> [--single]");
  process.exit(1);
}

// ============================================================
// Step 1: Follow redirects to get the final Google Photos URL
// ============================================================
async function resolveUrl(url) {
  if (url.includes("photos.app.goo.gl") || url.includes("goo.gl")) {
    const resp = await fetch(url, { redirect: "follow" });
    return resp.url;
  }
  return url;
}

// ============================================================
// Step 2: Fetch the page and extract full-res image URLs
// ============================================================
async function extractImageUrls(photosUrl) {
  const resp = await fetch(photosUrl);
  const html = await resp.text();

  // Google Photos embeds photo IDs in URLs like /pw/AP1Gcz... in the HTML.
  // Each unique ID = one photo. The URL without a size suffix serves the
  // original full-resolution image.
  const idRegex = /\/pw\/(AP1Gcz[A-Za-z0-9_-]+)/g;
  const ids = new Set();
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    ids.add(match[1]);
  }

  if (ids.size === 0) {
    console.error("❌ No images found on the Google Photos page.");
    console.error("   Make sure the link is a shared album or photo link.");
    process.exit(1);
  }

  const count = SINGLE ? 1 : ids.size;
  console.log(`📸 Found ${ids.size} photo(s) on the page.`);

  // Construct full-res URLs (no size param = original quality)
  return [...ids].slice(0, count).map(
    (id) => `https://lh3.googleusercontent.com/pw/${id}`
  );
}

// ============================================================
// Step 3: Download full-res image
// ============================================================
async function downloadImage(url, index) {
  const filename = `${randomUUID()}.jpg`;
  const filepath = resolve(PROJECT_ROOT, filename);

  console.log(`⬇️  Downloading image ${index + 1}...`);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  writeFileSync(filepath, buffer);

  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`   ✅ Saved ${filename} (${sizeMB} MB)`);

  return filename;
}

// ============================================================
// Step 4: Generate optimized mid/ and webp/ versions using sharp
// ============================================================
async function optimizeImage(filename) {
  const stem = filename.replace(/\.[^.]+$/, "");
  const srcPath = resolve(PROJECT_ROOT, filename);

  console.log(`🔧 Optimizing ${filename}...`);

  // Check orientation
  const metadata = await sharp(srcPath).metadata();
  const isLandscape = metadata.width > metadata.height;

  if (isLandscape) {
    console.error(`   ❌ REJECTED: ${filename} is landscape (${metadata.width}x${metadata.height}).`);
    console.error(`   All catalog images must be portrait (height ≥ width).`);
    unlinkSync(srcPath);
    return null;
  }

  console.log(`   📐 ${metadata.width}x${metadata.height} (portrait ✅)`);

  // mid/ — 1000px, q72
  await sharp(srcPath)
    .rotate() // auto-rotate based on EXIF
    .resize({ width: 1000, height: 1000, fit: "inside" })
    .webp({ quality: 72 })
    .toFile(resolve(PROJECT_ROOT, "mid", stem + ".webp"));
  console.log(`   ✅ mid/${stem}.webp`);

  // webp/ — 1600px, q75
  await sharp(srcPath)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside" })
    .webp({ quality: 75 })
    .toFile(resolve(PROJECT_ROOT, "webp", stem + ".webp"));
  console.log(`   ✅ webp/${stem}.webp`);

  // Auto-orient the original JPG fallback (write to temp first to avoid file lock on Windows)
  const tmpPath = srcPath + '.tmp';
  await sharp(srcPath).rotate().jpeg({ quality: 95 }).toFile(tmpPath);
  unlinkSync(srcPath);
  const { renameSync } = await import('fs');
  renameSync(tmpPath, srcPath);
  console.log(`   ✅ ${filename} (auto-oriented)`);

  return filename;
}

// ============================================================
// Step 5: Update FILES arrays in all source files
// ============================================================
function addToFileArrays(filename) {
  const entry = `"${filename}"`;
  const files = [
    { path: "index.html", marker: "const FILES = [" },
    { path: "media.js", marker: "window.CATALOG_FILES = [" },
    { path: "functions/share.js", marker: "const FILES = [" },
  ];

  let added = 0;

  for (const file of files) {
    const filepath = resolve(PROJECT_ROOT, file.path);
    if (!existsSync(filepath)) {
      console.warn(`⚠️  ${file.path} not found, skipping`);
      continue;
    }

    let content = readFileSync(filepath, "utf8");

    if (content.includes(filename)) {
      console.log(`ℹ️  ${file.path} already contains ${filename}`);
      continue;
    }

    // Find the FILES array
    const filesIdx = content.indexOf(file.marker);
    if (filesIdx === -1) {
      console.warn(`⚠️  Could not find FILES array in ${file.path}`);
      continue;
    }

    // Find the closing ] of the array
    const arrayStart = content.indexOf("[", filesIdx);
    let depth = 0;
    let arrayEnd = -1;
    for (let i = arrayStart; i < content.length; i++) {
      if (content[i] === "[") depth++;
      if (content[i] === "]") depth--;
      if (depth === 0) { arrayEnd = i; break; }
    }

    if (arrayEnd === -1) {
      console.warn(`⚠️  Could not find end of FILES array in ${file.path}`);
      continue;
    }

    // Insert before the closing ]
    const before = content.slice(0, arrayEnd);
    const after = content.slice(arrayEnd);
    const trimmed = before.trimEnd();
    const newContent = trimmed + ",\n    " + entry + "\n  " + after;

    writeFileSync(filepath, newContent);
    console.log(`✅ Added to ${file.path}`);
    added++;
  }

  return added;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log("🔗 Google Photos → Catalog Importer\n");

  // 1. Resolve the URL
  console.log("1️⃣  Resolving Google Photos link...");
  const resolvedUrl = await resolveUrl(RAW_URL);
  console.log(`   ${resolvedUrl}\n`);

  // 2. Extract image URLs
  console.log("2️⃣  Extracting image URLs...");
  const imageUrls = await extractImageUrls(resolvedUrl);
  console.log(`   Will download ${imageUrls.length} image(s)\n`);

  // 3. Download and optimize
  console.log("3️⃣  Downloading and optimizing images...\n");
  const addedFiles = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const filename = await downloadImage(imageUrls[i], i);
    const result = await optimizeImage(filename);
    if (result) {
      addedFiles.push(filename);
    }
    console.log("");
  }

  if (addedFiles.length === 0) {
    console.error("❌ No images were added (all rejected).");
    process.exit(1);
  }

  // 4. Update FILES arrays
  console.log("4️⃣  Updating FILES arrays...");
  for (const filename of addedFiles) {
    addToFileArrays(filename);
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`✅ Done! ${addedFiles.length} image(s) added to catalog.`);
  console.log(`   Next: npm run deploy`);
  console.log("═══════════════════════════════════════");
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
