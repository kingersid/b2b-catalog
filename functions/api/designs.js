// Chandni Silk Mills catalog — designs API (Pages Function).
//
//   GET /api/designs
//     -> { designs: [{ design_id, name, sort_order, created_at, active }] }
//
//   GET /api/designs?format=files
//     -> { files: ["design_id.jpg", ...] }  (compat for old FILES array consumers)
//
//   GET /api/designs?format=full
//     -> { designs: [{ ..., url, midUrl, webpUrl }] }  (with R2 URLs resolved)

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

  try {
    const { results } = await env.CATALOG_DB
      .prepare("SELECT design_id, name, sort_order, created_at, active FROM designs WHERE active = 1 ORDER BY sort_order ASC, created_at ASC")
      .all();

    if (format === "files") {
      // Compat: old FILES array was filenames; return design_id + ".jpg" for each
      return json({ files: results.map((r) => r.design_id + ".jpg") });
    }

    if (format === "full") {
      // Include resolved R2 URLs for each design
      const origin = url.origin;
      const designs = results.map((r) => ({
        ...r,
        url: `${origin}/designs/original/${r.design_id}.jpg`,
        midUrl: `${origin}/designs/mid/${r.design_id}.webp`,
        webpUrl: `${origin}/designs/webp/${r.design_id}.webp`,
      }));
      return json({ designs });
    }

    return json({ designs: results });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
