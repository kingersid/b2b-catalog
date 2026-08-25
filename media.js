// Chandni Silk Mills catalog — design list for admin/price pages.
// Fetched from D1 API at runtime. Legacy fallback included for local dev.

window.CATALOG_FILES = [];
window.CATALOG_TOTAL = 0;
window.CATALOG_LOADED = false;

async function loadCatalogFiles(pageSize = 48) {
  try {
    const origin = location.protocol === "file:" ? "https://chandni-catalog.pages.dev" : location.origin;
    const resp = await fetch(`${origin}/api/designs?format=pages&limit=${pageSize}`);
    const data = await resp.json();
    const designs = data.designs || [];
    if (designs.length > 0) {
      window.CATALOG_FILES = designs.map((d) => d.name).filter(Boolean);
      window.CATALOG_TOTAL = Number(data.total || designs.length);
      window.CATALOG_LOADED = true;
      return;
    }
  } catch (e) {
    console.warn('Failed to load catalog files from API:', e);
  }
  // Fallback for local dev / file:// (matches current R2 contents)
  window.CATALOG_FILES = [
    "03802cfb-7199-4a28-9553-adb938b57daa.jpg","0654584a-8f7a-4fc8-b625-cfefcefe5a62.jpg",
    "0e13170a-6da3-4e2b-82d6-679b146e0975.jpg","2558f53b-7ac6-4b14-9922-656f8abd2d7d.jpg",
    "2a11b4c5-1aea-4195-acdd-d9e0b28af3ab.jpg","2b6e988f-16bf-4da1-875d-c98500284bf4.jpg",
    "33ee0953-355d-4f6e-bcf3-7da1a483ca4c.jpg","3882a688-0d65-4576-b2ff-725c4ab597d2.jpg",
    "3acbe829-cb9d-4692-b173-59426f4a8666.jpg","43b0fe45-d784-4753-80e0-82abe1d5d885.jpg",
    "4a531f73-526e-496b-b8e6-80ab4a1d38a9.jpg","4fa24c3e-68fb-43e0-a156-eb5f0b549cc5.jpg",
    "580797ed-efff-467f-acaa-5ce3898e4cb5.jpg","68774310-895f-4389-9d8f-d2fc428ff69f.jpg",
    "6b1e6f7b-22c3-4a3e-90ac-e20043bed5f6.jpg","72c3a2c5-ed34-4518-bcaf-64d9a58128c4.jpg",
    "742cd8c1-cbda-48c3-a733-3cb6995107ea.jpg","756a7c1d-241d-44c6-a1d4-ccaed10308f3.jpg",
    "778bdcdf-4164-4bb2-8473-ae023ffba059.jpg","img_8327.jpg",
    "820be7d8-cddc-4e02-b69b-93930c097fcd.jpg","84d1c227-bfe4-4957-8bc5-4c0c4545b705.jpg",
    "90834bbb-add5-4694-b4bb-73b3c4fea1f4.jpg","91c35933-1929-4d2a-ab2b-c621546de9bc.jpg",
    "9685e7b4-71eb-4d10-9c0f-d70e68fec742.jpg","9b5482fe-3b1a-44d7-b406-b10d62c65255.jpg",
    "9e83b0cd-ed4e-489c-8874-dcca7b75083b.jpg","a636219e-38e3-4a94-ada7-3a70436e60e5.jpg",
    "ad28dc9e-1a1e-459a-aba0-3041b351db0a.jpg","b2a3d5a3-a723-4d1d-b414-c8d26d26cb68.jpg",
    "b4d93873-2ad8-45bd-af02-f12f11126a3a.jpg","c05ddc8a-652d-40c1-974c-4346b192660f.jpg",
    "cb75ec62-09c7-4037-a1bf-6fefce805a05.jpg","d0af4d78-3622-414e-8ab6-fe9d34313870.jpg",
    "d905329f-89f2-4c1c-b9d6-e7efe61b35c1.jpg","e9967125-2c41-43d8-92a2-f602426a7efe.jpg",
    "f2c44321-1dd9-4840-a795-31053617549c.jpg","f5205103-876c-4abf-b2cb-1ccfd61bf2ac.jpg",
    "f8a3ba95-582f-4ada-b792-b7c18aea2f64.jpg","fd482538-794f-47e4-b4f8-ce9ff619427e.jpg",
    "fea97d8e-626a-4449-9d1b-aeb50ba7d1d3.jpg","img_0295.jpg",
    "img_0467.jpg","img_0515.jpg","819d3441-207b-4355-8c0a-c6d3dc743341.jpg",
    "img_8453.jpg","img_8928.jpg","img_8930.jpg","img_9078.jpg","img_9199.jpg","img_9662.jpg",
    "92eea7d7-a9a1-4852-b52a-ccb9ea6740a8.jpg","824d67c0-68b4-42f7-906b-074c5e8c07cb.jpg"
  ];
  window.CATALOG_TOTAL = window.CATALOG_FILES.length;
  window.CATALOG_LOADED = true;
}

loadCatalogFiles();
