// Chandni Silk Mills — Prices API (D1-backed).
//   GET  /prices            -> { prices: { [itemId]: price } }
//   POST /prices            body { itemId, price }  -> { ok, itemId, price }
//                            price = null removes the price.
//   OPTIONS                  -> CORS preflight

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-upload-key" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

async function getAllPrices(env) {
  const { results } = await env.CATALOG_DB.prepare("SELECT item_id, price FROM prices").all();
  const prices = {};
  for (const r of results) prices[r.item_id] = r.price;
  return { prices };
}

async function setPrice(env, itemId, price) {
  if (price == null) {
    await env.CATALOG_DB.prepare("DELETE FROM prices WHERE item_id = ?").bind(itemId).run();
    return { ok: true, itemId, price: null };
  }
  await env.CATALOG_DB
    .prepare(
      "INSERT INTO prices (item_id, price) VALUES (?1, ?2) " +
      "ON CONFLICT(item_id) DO UPDATE SET price = ?2"
    )
    .bind(itemId, price)
    .run();
  return { ok: true, itemId, price };
}

async function authorized(request, env) {
  if (!env.UPLOAD_KEY) return false;
  const given = new TextEncoder().encode(request.headers.get("x-upload-key") || "");
  const expected = new TextEncoder().encode(env.UPLOAD_KEY);
  if (given.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < given.byteLength; index++) difference |= given[index] ^ expected[index];
  return difference === 0;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    if (request.method === "GET") {
      return json(await getAllPrices(env));
    }

    if (request.method === "POST") {
      if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const itemId = String(body?.itemId ?? "").trim().slice(0, 255);
      if (!itemId) return json({ error: "itemId required" }, 400);
      const raw = body?.price;
      const price = raw == null || raw === "" ? null : Number(raw);
      if (price != null && (!Number.isInteger(price) || price < 0)) {
        return json({ error: "price must be a non-negative integer" }, 400);
      }
      return json(await setPrice(env, itemId, price));
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    console.error("prices fn error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
}
