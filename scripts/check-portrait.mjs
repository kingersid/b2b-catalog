#!/usr/bin/env node
// check-portrait.mjs — deploy guard: refuses to continue if ANY image in the
// project is landscape (width > height after applying EXIF orientation).
//
// "Portrait" means the image displays with height >= width. A phone photo stored
// sideways (e.g. 4032x3024 with EXIF Orientation=6) displays portrait, so the
// orientation flag is honored here — a sideways-stored photo is NOT accepted.
//
// Dependency-free: parses JPEG/WebP/PNG/GIF headers directly from the first
// bytes of each file. Run via:  npm run deploy  (runs this check first).
//
// Exit code 0 = all portrait, 1 = landscape found (deploy should abort).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const SKIP_DIRS = new Set([".wrangler", "node_modules", ".git"]);

// ---- EXIF orientation ------------------------------------------------------
// Tag 0x0112. Values 5-8 mean the image must be rotated 90°, so swap w/h.
export function exifOrientation(buf, isLittleEndian, ifdOffset) {
  const u16 = (o) => (isLittleEndian ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (isLittleEndian ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const count = u16(ifdOffset);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    if (u16(entry) === 0x0112) return u16(entry + 8); // Orientation value (SHORT)
  }
  return 1;
}

// ---- per-format dimension parsing -------------------------------------------
function jpegDims(buf) {
  // Walk markers until an SOF; collect EXIF orientation from APP1.
  let off = 2;
  let w = 0, h = 0, orient = 1;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2 || off + 2 + len > buf.length) break;
    if (marker === 0xe1 && buf.toString("ascii", off + 4, off + 10) === "Exif\0\0") {
      const t = off + 4 + 6; // start of TIFF header
      const endian = buf.toString("ascii", t, t + 2);
      if (endian === "II" || endian === "MM") {
        const le = endian === "II";
        const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        if (u16(t + 2) === 42) orient = exifOrientation(buf, le, t + u32(t + 4));
      }
    } else if (
      marker >= 0xc0 && marker <= 0xc3 ||
      marker >= 0xc5 && marker <= 0xc7 ||
      marker >= 0xc9 && marker <= 0xcb ||
      marker >= 0xcd && marker <= 0xcf
    ) {
      h = buf.readUInt16BE(off + 5);
      w = buf.readUInt16BE(off + 7);
      break;
    }
    off += 2 + len;
  }
  return w && h ? { w, h, orient } : null;
}

function webpDims(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  let off = 12;
  let w = 0, h = 0, orient = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const data = off + 8;
    if (id === "VP8X") {
      w = 1 + (buf[data + 4] | (buf[data + 5] << 8) | (buf[data + 6] << 16));
      h = 1 + (buf[data + 7] | (buf[data + 8] << 8) | (buf[data + 9] << 16));
    } else if (id === "VP8 ") {
      w = buf.readUInt16LE(data + 6);
      h = buf.readUInt16LE(data + 8);
    } else if (id === "VP8L") {
      const bits = buf.readUInt32LE(data + 1);
      w = 1 + (bits & 0x3fff);
      h = 1 + ((bits >> 14) & 0x3fff);
    } else if (id === "EXIF" && data + 6 <= buf.length && buf.toString("ascii", data, data + 6) === "Exif\0\0") {
      const t = data + 6;
      const endian = buf.toString("ascii", t, t + 2);
      if (endian === "II" || endian === "MM") {
        const le = endian === "II";
        const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        if (u16(t + 2) === 42) orient = exifOrientation(buf, le, t + u32(t + 4));
      }
    }
    if (size === 0) break;
    off = data + size + (size & 1);
  }
  return w && h ? { w, h, orient } : null;
}

function pngDims(buf) {
  // latin1 (not ascii): ascii masks the high bit, mangling the 0x89 signature byte.
  if (buf.toString("latin1", 0, 8) !== "\x89PNG\r\n\x1a\n") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), orient: 1 };
}

function gifDims(buf) {
  if (!(buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")) return null;
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), orient: 1 };
}

function dimsFor(file, buf) {
  const ext = file.split(".").pop().toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return jpegDims(buf);
  if (ext === "webp") return webpDims(buf);
  if (ext === "png") return pngDims(buf);
  if (ext === "gif") return gifDims(buf);
  return null;
}

// ---- walk the tree -----------------------------------------------------------
function collectImages(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectImages(p, out);
    else if (IMAGE_RE.test(name)) out.push(p);
  }
}

function run() {
  const images = [];
  collectImages(ROOT, images);

  const landscape = [];
  let unreadable = [];
  for (const p of images) {
    const buf = readFileSync(p); // headers only, but files are small enough
    const dims = dimsFor(p, buf);
    if (!dims) { unreadable.push(relative(ROOT, p)); continue; }
    let { w, h } = dims;
    if (dims.orient >= 5 && dims.orient <= 8) [w, h] = [h, w]; // needs 90° rotation
    if (w > h) landscape.push({ file: relative(ROOT, p), dims: `${w}x${h}`, orient: dims.orient });
  }

  const ok = landscape.length === 0 && unreadable.length === 0;
  console.log(`check-portrait: ${images.length} images scanned`);
  if (ok) {
    console.log("check-portrait: ALL IMAGES PORTRAIT — deploy may proceed ✓");
  } else {
    for (const l of landscape) {
      console.error(`  LANDSCAPE  ${l.file}  (${l.dims}${l.orient !== 1 ? `, exif orientation ${l.orient}` : ""})`);
    }
    for (const f of unreadable) console.error(`  UNREADABLE ${f}  (could not determine dimensions)`);
    console.error(`check-portrait: ${landscape.length} landscape + ${unreadable.length} unreadable — DEPLOY ABORTED`);
  }
  process.exit(ok ? 0 : 1);
}

// Only run the scan when executed directly (`node scripts/check-portrait.mjs`),
// so the helpers can be imported (e.g. by tests) without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
