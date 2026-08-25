// Chandni Silk Mills catalog — designs API (Pages Function).
//
//   GET /api/designs
//     -> { designs: [{ design_id, name, sort_order, created_at, active }] }
//
//   GET /api/designs?format=files
//     -> { files: ["design_id.jpg", ...] }  (compat for old FILES array consumers)
//
//   GET /api/designs?img=designs/original/{id}.jpg
//     -> raw image bytes (R2 proxy with caching)

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
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

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "default";
  const imgKey = url.searchParams.get("img");
  const origin = url.origin;

  try {
    // Image proxy mode: serve raw bytes from R2
    if (imgKey) {
      const validPrefix = "designs/";
      if (!imgKey.startsWith(validPrefix)) {
        return new Response("Invalid key", { status: 400 });
      }
      const object = await env.DESIGNS_BUCKET.get(imgKey);
      if (!object) return new Response("Not found", { status: 404 });

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      headers.set("access-control-allow-origin", "*");
      return new Response(object.body, { headers });
    }

    // List mode
    const { results } = await env.CATALOG_DB
      .prepare("SELECT design_id, name, sort_order, created_at, active FROM designs WHERE active = 1 ORDER BY sort_order ASC, created_at ASC")
      .all();

    if (format === "files") {
      // Compat: old FILES array was filenames; return design_id + ".jpg" for each
      return json({ files: results.map((r) => r.design_id + ".jpg") });
    }

    if (format === "full") {
      // Include resolved image URLs for each design
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || results.length), 100));
      const offset = (page - 1) * limit;
      const total = results.length;
      const pageItems = results.slice(offset, offset + limit);
      const designs = pageItems.map((r) => ({
        ...r,
        url: `${origin}/api/designs?img=designs/original/${r.design_id}.jpg`,
        midUrl: `${origin}/api/designs?img=designs/mid/${r.design_id}.webp`,
        webpUrl: `${origin}/api/designs?img=designs/webp/${r.design_id}.webp`,
      }));
      return json({ designs, page, limit, total, totalPages: Math.ceil(total / limit) });
    }

    if (format === "pages") {
      // Paginated list with metadata — optimized for lazy-load feeds
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 36), 100));
      const offset = (page - 1) * limit;
      const total = results.length;
      const pageItems = results.slice(offset, offset + limit);
      const designs = pageItems.map((r) => ({
        design_id: r.design_id,
        name: r.name,
        sort_order: r.sort_order,
        url: `${origin}/api/designs?img=designs/original/${r.design_id}.jpg`,
        midUrl: `${origin}/api/designs?img=designs/mid/${r.design_id}.webp`,
        webpUrl: `${origin}/api/designs?img=designs/webp/${r.design_id}.webp`,
      }));
      return json({ designs, page, limit, total, totalPages: Math.ceil(total / limit) });
    }

    return json({ designs: results });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
