// Build a one-time Commerce Manager import from the public live catalog.
// Run: node scripts/build-meta-feed.mjs
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://chandni-catalog.pages.dev";
const output = resolve("meta-catalog-import.csv");
const metaPlaceholderPrice = "1 INR";

const [designResponse, priceResponse] = await Promise.all([
  fetch(`${origin}/api/designs?format=full`),
  fetch(`${origin}/prices`),
]);
if (!designResponse.ok || !priceResponse.ok) {
  throw new Error(`Catalog API failed: designs=${designResponse.status}, prices=${priceResponse.status}`);
}

const { designs } = await designResponse.json();
const { prices } = await priceResponse.json();
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const columns = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];
const rows = [];
const skipped = [];

async function imageFor(design) {
  for (const extension of ["jpg", "webp"]) {
    const key = `designs/original/${design.design_id}.${extension}`;
    const url = `${origin}/api/designs?img=${encodeURIComponent(key)}`;
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok && response.headers.get("content-type")?.startsWith("image/")) return { url, extension };
  }
  return null;
}

// Limit concurrent image checks so the public image proxy is not flooded.
const priced = designs.map((design, index) => ({ design, index })).filter(({ design }) => {
  const price = prices[design.name] ?? prices[design.design_id];
  if (Number.isInteger(price) && price > 0) return true;
  skipped.push({ id: design.design_id, reason: "no positive saved price" });
  return false;
});
const batches = [];
for (let start = 0; start < priced.length; start += 8) batches.push(priced.slice(start, start + 8));
for (const batch of batches) {
  const checked = await Promise.all(batch.map(async ({ design, index }) => ({ design, index, image: await imageFor(design) })));
  for (const { design, index, image } of checked) {
    if (!image) {
      skipped.push({ id: design.design_id, reason: "no accessible original image" });
      continue;
    }
    const title = `Chandni Silk Mills Design #${index + 1}`;
    const description = `Price on request. Chandni Silk Mills textile design ${design.name}. Contact us for current wholesale pricing, fabric details and availability.`;
    const link = `${origin}/share?id=${encodeURIComponent(design.design_id)}`;
    rows.push([design.design_id, title, description, "available for order", "new", metaPlaceholderPrice, link, image.url, "Chandni Silk Mills"]);
  }
}

const csv = [columns, ...rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
await writeFile(output, csv, "utf8");
console.log(JSON.stringify({ output, active: designs.length, importable: rows.length, skipped }, null, 2));
