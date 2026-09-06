// Chandni Silk Mills catalog — upload endpoint (Pages Function).
//
//   POST /api/upload   multipart/form-data:
//     key    -> must equal the UPLOAD_KEY secret (only the owner can upload)
//     design -> one image file (the optimized JPG produced client-side)
//
// What it does:
//   1. Verifies the shared key.
//   2. Puts the original image to R2 as designs/original/{id}.jpg
//   3. Inserts a row into the `designs` table.
//   4. Returns the design record — live in the catalog in ~1 second.
//
// Required secrets (set once):
//   npx wrangler pages secret put UPLOAD_KEY

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const expectedKey = env.UPLOAD_KEY;
  if (!expectedKey) return json({ error: "UPLOAD_KEY not configured" }, 503);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  // Timing-safe-ish key comparison
  const key = String(form.get("key") || "");
  if (key !== expectedKey) return json({ error: "Wrong key" }, 401);

  const file = form.get("design");
  if (!(file instanceof File)) return json({ error: "Missing design file" }, 400);

  // Only accept JPEG/WEBP (the client produces these)
  if (!/\.(jpg|jpeg|webp)$/i.test(file.name)) {
    return json({ error: "Only JPG and WEBP accepted" }, 400);
  }

  // Unique ID from UUID; friendly name from the original filename stem
  const designId = crypto.randomUUID().toLowerCase();
  const ext = file.name.split(".").pop().toLowerCase() === "webp" ? "webp" : "jpg";
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 80); // filename stem for display

  // Prevent duplicate uploads by normalized name or design_id reuse
  const normalized = name.toLowerCase();
  const exists = await env.CATALOG_DB.prepare(
    "SELECT 1 FROM designs WHERE LOWER(name) = ? OR design_id = ? LIMIT 1"
  ).bind(normalized, designId).first();
  if (exists) {
    return json({ error: "This design is already in the catalog" }, 409);
  }

  try {
    const bytes = await file.arrayBuffer();

    // 1. Put image to R2 (original + derived sizes remain a client concern;
    //    for now we store the original — catalog renders via this object).
    const r2Key = `designs/original/${designId}.${ext}`;
    await env.DESIGNS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: ext === "webp" ? "image/webp" : "image/jpeg" },
    });

    // 2. Insert into D1 designs table
    await env.CATALOG_DB.prepare(
      "INSERT INTO designs (design_id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM designs))"
    ).bind(designId, name).run();

    const created = await env.CATALOG_DB.prepare(
      "SELECT design_id, name, sort_order, created_at, active FROM designs WHERE design_id = ?"
    ).bind(designId).first();

    return json({ ok: true, design: created, url: `/designs/original/${designId}.${ext}` });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
