// Upload all catalog images to R2 using wrangler CLI
// Run: node scripts/upload-r2.mjs

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BUCKET = 'chandni-catalog-assets';

const FILES = [
  "03802cfb-7199-4a28-9553-adb938b57daa.jpg","0654584a-8f7a-4fc8-b625-cfefcefe5a62.jpg",
  "0e13170a-6da3-4e2b-82d6-679b146e0975.jpg","2558f53b-7ac6-4b14-9922-656f8abd2d7d.jpg",
  "2a11b4c5-1aea-4195-acdd-d9e0b28af3ab.jpg","2b6e988f-16bf-4da1-875d-c98500284bf4.jpg",
  "33ee0953-355d-4f6e-bcf3-7da1a483ca4c.jpg","3882a688-0d65-4576-b2ff-725c4ab597d2.jpg",
  "3acbe829-cb9d-4692-b173-59426f4a8666.jpg",
  "43b0fe45-d784-4753-80e0-82abe1d5d885.jpg","4a531f73-526e-496b-b8e6-80ab4a1d38a9.jpg",
  "4fa24c3e-68fb-43e0-a156-eb5f0b549cc5.jpg","580797ed-efff-467f-acaa-5ce3898e4cb5.jpg",
  "68774310-895f-4389-9d8f-d2fc428ff69f.jpg","6B1E6F7B-22C3-4A3E-90AC-E20043BED5F6.jpg",
  "72C3A2C5-ED34-4518-BCAF-64D9A58128C4.jpg","742cd8c1-cbda-48c3-a733-3cb6995107ea.jpg",
  "756A7C1D-241D-44C6-A1D4-CCAED10308F3.jpg","778bdcdf-4164-4bb2-8473-ae023ffba059.jpg",
  "IMG_8327.JPG","820be7d8-cddc-4e02-b69b-93930c097fcd.jpg",
  "84d1c227-bfe4-4957-8bc5-4c0c4545b705.jpg","90834BBB-ADD5-4694-B4BB-73B3C4FEA1F4.jpg",
  "91c35933-1929-4d2a-ab2b-c621546de9bc.jpg","9685e7b4-71eb-4d10-9c0f-d70e68fec742.jpg",
  "9b5482fe-3b1a-44d7-b406-b10d62c65255.jpg","9e83b0cd-ed4e-489c-8874-dcca7b75083b.jpg",
  "a636219e-38e3-4a94-ada7-3a70436e60e5.jpg","ad28dc9e-1a1e-459a-aba0-3041b351db0a.jpg",
  "b2a3d5a3-a723-4d1d-b414-c8d26d26cb68.jpg","b4d93873-2ad8-45bd-af02-f12f11126a3a.jpg",
  "C05DDC8A-652D-40C1-974C-4346B192660F.jpg","cb75ec62-09c7-4037-a1bf-6fefce805a05.jpg",
  "d0af4d78-3622-414e-8ab6-fe9d34313870.jpg","d905329f-89f2-4c1c-b9d6-e7efe61b35c1.jpg",
  "E9967125-2C41-43D8-92A2-F602426A7EFE.jpg","f2c44321-1dd9-4840-a795-31053617549c.jpg",
  "f5205103-876c-4abf-b2cb-1ccfd61bf2ac.jpg","f8a3ba95-582f-4ada-b792-b7c18aea2f64.jpg",
  "FD482538-794F-47E4-B4F8-CE9FF619427E.jpg","FEA97D8E-626A-4449-9D1B-AEB50BA7D1D3.jpg",
  "IMG_0295.JPG","IMG_0467.JPG","IMG_0515.JPG",
  "819d3441-207b-4355-8c0a-c6d3dc743341.jpg","IMG_8453.JPG",
  "IMG_8928.JPG","IMG_8930.JPG","IMG_9078.JPG",
  "IMG_9199.JPG","IMG_9662.JPG",
  "98edd9f5-d59b-4b28-aba8-e6eb16a4befe.jpg"
];

const stem = (f) => f.replace(/\.[^.]+$/, '').toLowerCase();

console.log(`Uploading ${FILES.length} images to R2...`);

let success = 0;
let failed = 0;

for (const f of FILES) {
  const id = stem(f);
  const key = `designs/original/${id}.jpg`;
  
  if (!fs.existsSync(f)) {
    console.log(`⚠️ Missing: ${f}`);
    failed++;
    continue;
  }
  
  try {
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${key}" --file="${f}" --content-type=image/jpeg --remote`,
      { stdio: 'pipe', timeout: 30000 }
    );
    success++;
    console.log(`✓ ${f}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${f}: ${e.message.slice(0, 100)}`);
  }
}

console.log(`\nDone: ${success} uploaded, ${failed} failed`);
