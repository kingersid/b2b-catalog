const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-upload-key",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
});

const encoder = new TextEncoder();
function keysMatch(given, expected) {
  const a = encoder.encode(String(given || ""));
  const b = encoder.encode(String(expected || ""));
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function authorized(request, env, bodyKey = "") {
  if (!env.UPLOAD_KEY) return false;
  const headerKey = request.headers.get("x-upload-key") || "";
  return keysMatch(headerKey || bodyKey, env.UPLOAD_KEY);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const { results } = await env.CATALOG_DB.prepare(
    `SELECT d.design_id, d.name, d.sort_order, d.created_at, d.active,
            COALESCE(p_name.price, p_id.price) AS price
       FROM designs d
       LEFT JOIN prices p_name ON p_name.item_id = d.name
       LEFT JOIN prices p_id ON p_id.item_id = d.design_id
      ORDER BY d.active DESC, d.sort_order DESC, d.created_at DESC`
  ).all();
  return json({ designs: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  if (!(await authorized(request, env, body?.key))) return json({ error: "Unauthorized" }, 401);

  const designId = String(body?.designId || "").trim();
  const active = body?.active === true || body?.active === 1 ? 1 : body?.active === false || body?.active === 0 ? 0 : null;
  if (!designId || active == null) return json({ error: "designId and active are required" }, 400);

  const result = await env.CATALOG_DB.prepare(
    "UPDATE designs SET active = ? WHERE design_id = ?"
  ).bind(active, designId).run();
  if (!result.meta?.changes) return json({ error: "Design not found" }, 404);

  return json({ ok: true, designId, active });
}
