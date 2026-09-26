import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, '.pages-dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);

const entries = await readdir(root, { withFileTypes: true });
const publicPages = new Set(['index.html', 'admin.html', 'dashboard.html', 'price-catalog.html', 'privacy.html', 'upload.html', 'swipe-hint-prototype.html', 'media.js', '_headers']);
const publicFiles = entries.filter(entry => entry.isFile() &&
  (publicPages.has(entry.name) || /\.(jpg|jpeg|png|webp|svg|ico|webmanifest)$/i.test(entry.name)));
for (const file of publicFiles) {
  await cp(path.join(root, file.name), path.join(output, file.name));
}
for (const directory of ['mid', 'webp']) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}
console.log(`Staged ${publicFiles.length} public files and image directories in .pages-dist`);
