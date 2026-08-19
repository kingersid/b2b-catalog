// Chandni Silk Mills catalog — Cloudflare Pages Function (D1-backed).
// Drop-in replacement for the old Netlify function (netlify/functions/catalog.js).
// Endpoints:
//
//   GET  /api/catalog                         -> { today, count }  today's visits (Asia/Kolkata)
//   GET  /api/catalog?action=hearts           -> { hearts: { [itemId]: count } }
//   GET  /api/catalog?action=reach&key=...    -> funnel + CTA clicks + sources (dashboard; key-protected)
//   POST /api/catalog?action=addVisit         body {source}        -> { today, count }  increments today's visit (+ source)
//   POST /api/catalog?action=heart            body {itemId, delta} -> { itemId, count }
//   POST /api/catalog?action=ctaClick         body {itemId}        -> { itemId, count }  per-design CTA click
//   POST /api/catalog?action=reach            body {depth, from}   -> { depth }  fills [from..depth] (cumulative)
//
// Persistence: Cloudflare D1 (SQLite) via the CATALOG_DB binding. Schema in schema.sql.
// Dashboard access key: DASH_KEY binding (set via `wrangler pages secret put DASH_KEY`).

// CORS: the catalog can be opened from file:// (null origin) for local preview, so
// allow any origin. The catalog itself never sends credentials.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

// Today's date in Asia/Kolkata (the business's timezone) -> "YYYY-MM-DD".
function todayKolkata() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const CUTOFF_DAYS = 35; // keep ~35 days of counters/funnel

async function pruneOld(env, table) {
  const cutoff = new Date(Date.now() - CUTOFF_DAYS * 864e5).toISOString().slice(0, 10);
  await env.CATALOG_DB.prepare(`DELETE FROM ${table} WHERE day < ?`).bind(cutoff).run();
}

async function getSiteVisits(env) {
  const today = todayKolkata();
  const row = await env.CATALOG_DB
    .prepare("SELECT count FROM visits WHERE day = ?")
    .bind(today)
    .first();
  return { today, count: row?.count ?? 0 };
}

async function addSiteVisit(env, source) {
  const today = todayKolkata();
  await env.CATALOG_DB
    .prepare(
      "INSERT INTO visits (day, count) VALUES (?1, 1) " +
      "ON CONFLICT(day) DO UPDATE SET count = count + 1"
    )
    .bind(today)
    .run();
  if (source) {
    await env.CATALOG_DB
      .prepare(
        "INSERT INTO sources (day, source, count) VALUES (?1, ?2, 1) " +
        "ON CONFLICT(day, source) DO UPDATE SET count = count + 1"
      )
      .bind(today, String(source).slice(0, 100))
      .run();
    await pruneOld(env, "sources");
  }
  await pruneOld(env, "visits");
  return getSiteVisits(env);
}

async function getHearts(env) {
  const { results } = await env.CATALOG_DB
    .prepare("SELECT item_id, count FROM hearts")
    .all();
  const hearts = {};
  for (const r of results) hearts[r.item_id] = r.count;
  return { hearts };
}

async function addHeart(env, itemId, delta) {
  await env.CATALOG_DB
    .prepare(
      "INSERT INTO hearts (item_id, count) VALUES (?1, ?2) " +
      "ON CONFLICT(item_id) DO UPDATE SET count = MAX(0, count + ?2)"
    )
    .bind(itemId, delta)
    .run();
  const row = await env.CATALOG_DB
    .prepare("SELECT count FROM hearts WHERE item_id = ?")
    .bind(itemId)
    .first();
  return { itemId, count: row?.count ?? 0 };
}

// Per-design WhatsApp CTA click (main conversion signal).
async function addCtaClick(env, itemId) {
  await env.CATALOG_DB
    .prepare(
      "INSERT INTO cta (item_id, count) VALUES (?1, 1) " +
      "ON CONFLICT(item_id) DO UPDATE SET count = count + 1"
    )
    .bind(itemId)
    .run();
  const row = await env.CATALOG_DB
    .prepare("SELECT count FROM cta WHERE item_id = ?")
    .bind(itemId)
    .first();
  return { itemId, count: row?.count ?? 0 };
}

// A session reported reaching `depth` (1 = first product image). The client sends
// `from` = first depth of the newly covered range (backfilling slides skipped by fast
// swipes), so every depth in [from..depth] gets +1. Each row is therefore cumulative:
// depth N's count = sessions that reached AT LEAST image N.
async function addReach(env, depth, from) {
  const today = todayKolkata();
  const d = Math.max(1, Math.min(Number(depth) || 1, 1000));
  const f = Math.max(1, Math.min(Number(from) || d, d));
  const stmt = env.CATALOG_DB.prepare(
    "INSERT INTO reach (day, depth, count) VALUES (?1, ?2, 1) " +
    "ON CONFLICT(day, depth) DO UPDATE SET count = count + 1"
  );
  const batch = [];
  for (let i = f; i <= d; i++) batch.push(stmt.bind(today, i));
  if (batch.length) await env.CATALOG_DB.batch(batch);
  await pruneOld(env, "reach");
  return { depth: d, from: f };
}

// Funnel summary for the dashboard. Key-protected (DASH_KEY binding).
async function getReach(env) {
  const today = todayKolkata();
  const [todayRows, allRows, visitToday, visitAll, ctaRows, srcToday, srcAll] = await Promise.all([
    env.CATALOG_DB.prepare("SELECT depth, count FROM reach WHERE day = ?").bind(today).all(),
    env.CATALOG_DB.prepare("SELECT depth, SUM(count) AS total FROM reach GROUP BY depth ORDER BY depth").all(),
    env.CATALOG_DB.prepare("SELECT count FROM visits WHERE day = ?").bind(today).first(),
    env.CATALOG_DB.prepare("SELECT SUM(count) AS total FROM visits").first(),
    env.CATALOG_DB.prepare("SELECT item_id, count FROM cta").all(),
    env.CATALOG_DB.prepare("SELECT source, count FROM sources WHERE day = ? ORDER BY count DESC").bind(today).all(),
    env.CATALOG_DB.prepare("SELECT source, SUM(count) AS total FROM sources GROUP BY source ORDER BY total DESC").all(),
  ]);
  return {
    today,
    totalItems: 51, // product count; dashboard renders bars 1..totalItems
    visitsToday: visitToday?.count ?? 0,
    visitsAll: visitAll?.total ?? 0,
    todayFunnel: (todayRows.results || []).map((r) => ({ depth: r.depth, count: r.count })),
    allFunnel: (allRows.results || []).map((r) => ({ depth: r.depth, count: r.total })),
    ctaClicks: Object.fromEntries((ctaRows.results || []).map((r) => [r.item_id, r.count])),
    sourcesToday: (srcToday.results || []).map((r) => ({ source: r.source, count: r.count })),
    sourcesAll: (srcAll.results || []).map((r) => ({ source: r.source, count: r.total })),
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    if (request.method === "GET") {
      if (action === "hearts") return json(await getHearts(env));
      if (action === "reach") {
        // Dashboard access: require the shared key (constant-ish compare).
        const expected = env.DASH_KEY;
        if (!expected) return json({ error: "dashboard key not configured (DASH_KEY)" }, 503);
        const given = url.searchParams.get("key") || request.headers.get("x-dash-key") || "";
        const ok = given.length === expected.length && given === expected;
        if (!ok) return json({ error: "invalid dashboard key" }, 401);
        return json(await getReach(env));
      }
      return json(await getSiteVisits(env)); // default: today's visits
    }

    if (request.method === "POST") {
      if (action === "addVisit") {
        const body = await request.json().catch(() => ({}));
        return json(await addSiteVisit(env, body?.source));
      }
      if (action === "heart") {
        const body = await request.json();
        const itemId = String(body?.itemId ?? "").trim().slice(0, 255);
        if (!itemId) return json({ error: "itemId required" }, 400);
        const delta = Number(body?.delta) || 1;
        return json(await addHeart(env, itemId, delta));
      }
      if (action === "ctaClick") {
        const body = await request.json().catch(() => ({}));
        const itemId = String(body?.itemId ?? "").trim().slice(0, 255);
        if (!itemId) return json({ error: "itemId required" }, 400);
        return json(await addCtaClick(env, itemId));
      }
      if (action === "reach") {
        const body = await request.json().catch(() => ({}));
        return json(await addReach(env, Number(body?.depth) || 1, Number(body?.from)));
      }
      return json({ error: "unknown action" }, 400);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    console.error("catalog fn error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
}
