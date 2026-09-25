// Live Meta Commerce catalog feed.
// Meta fetches this URL on its replace schedule; active, priced designs are
// included and hidden or unpriced designs are omitted.

const ORIGIN = "https://chandni-catalog.pages.dev";

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.CATALOG_DB.prepare(
      `SELECT d.design_id, d.name, d.sort_order,
              COALESCE(p_name.price, p_id.price) AS price
         FROM designs d
         LEFT JOIN prices p_name ON p_name.item_id = d.name
         LEFT JOIN prices p_id ON p_id.item_id = d.design_id
        WHERE d.active = 1
          AND COALESCE(p_name.price, p_id.price) > 0
        ORDER BY d.sort_order DESC, d.created_at DESC`
    ).all();

    const columns = [
      "id", "title", "description", "availability", "condition",
      "price", "link", "image_link", "brand",
    ];
    const rows = results.map((design, index) => [
      design.design_id,
      `Chandni Silk Mills Design #${index + 1}`,
      `Chandni Silk Mills textile design ${design.name}. Contact us for fabric details, availability and wholesale orders.`,
      "available for order",
      "new",
      `${design.price} INR`,
      `${ORIGIN}/share?id=${encodeURIComponent(design.design_id)}`,
      `${ORIGIN}/api/designs?img=${encodeURIComponent(`designs/original/${design.design_id}.jpg`)}`,
      "Chandni Silk Mills",
    ]);
    const body = [columns, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") + "\r\n";

    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'inline; filename="chandni-meta-catalog.csv"',
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "meta_feed_error", error: String(error?.message || error) }));
    return new Response("Unable to build catalog feed", { status: 500 });
  }
}
