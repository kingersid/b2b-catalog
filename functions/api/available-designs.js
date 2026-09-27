// Public, price-free list for the WhatsApp available-designs catalog.
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

export async function onRequestGet({ env }) {
  try {
    const [designRows, priceRows] = await Promise.all([
      env.CATALOG_DB.prepare(`SELECT d.design_id, d.name, m.title, m.fabric_type,
        m.pattern, m.colors, m.use_cases, m.moq_meters
        FROM designs d JOIN design_metadata m ON m.design_id = d.design_id
        WHERE d.active = 1 AND m.availability = 'available'
        ORDER BY d.sort_order DESC, d.created_at DESC`).all(),
      env.CATALOG_DB.prepare("SELECT item_id, price FROM prices WHERE price > 0").all(),
    ]);
    const prices = new Map(priceRows.results.map(row => [String(row.item_id), Number(row.price)]));
    const stem = name => name.replace(/\.[^.]+$/, "");
    const designs = designRows.results.flatMap(row => {
      const id = String(row.design_id);
      const name = String(row.name || "");
      const hasPrice = [id, name, stem(name), id.toLowerCase(), name.toLowerCase(), stem(name).toLowerCase()]
        .some(key => Number.isFinite(prices.get(key)) && prices.get(key) > 0);
      if (!hasPrice) return [];
      return [{
        design_id: id,
        title: row.title || name || id,
        fabric_type: row.fabric_type || null,
        pattern: row.pattern || null,
        colors: row.colors || null,
        use_cases: row.use_cases || null,
        moq_meters: row.moq_meters || null,
      }];
    });
    return new Response(JSON.stringify({ designs, total: designs.length }), { headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "available_designs_error", error: String(error?.message || error) }));
    return new Response(JSON.stringify({ error: "Unable to load available designs" }), { status: 500, headers });
  }
}
