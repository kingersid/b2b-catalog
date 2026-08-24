// Cloudflare Pages Function: /share.html?id=... or /share.html?index=N
// Renders the share page with OG meta tags set in the HTML (not via JS),
// so WhatsApp/social crawlers can read them for preview cards.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;
  const params = url.searchParams;
  const id = params.get("id");
  const idx = params.get("index");

  try {
    // Fetch designs from D1
    const { results } = await env.CATALOG_DB
      .prepare("SELECT design_id, name, sort_order FROM designs WHERE active = 1 ORDER BY sort_order ASC, created_at ASC")
      .all();

    const files = results.map((r) => r.design_id + ".jpg");
    const total = files.length;

    let file = null;
    let designNum = 0;

    if (id) {
      const idxFound = files.findIndex((f) => f.replace(/\.[^.]+$/, "").toLowerCase() === id.toLowerCase());
      if (idxFound >= 0) { file = files[idxFound]; designNum = idxFound + 1; }
    } else if (idx !== null) {
      const i = parseInt(idx, 10);
      if (i >= 0 && i < total) { file = files[i]; designNum = i + 1; }
    }

    const stem = (f) => f.replace(/\.[^.]+$/, "");
    const imgUrl = (f) => origin + "/api/designs?img=" + encodeURIComponent("designs/original/" + f);

    const imageUrl = file ? imgUrl(file) : origin + "/landing.webp";
    const title = file ? `Design #${designNum} — Chandni Silk Mills` : "Chandni Silk Mills";
    const description = file
      ? `Design #${designNum} of ${total} from Chandni Silk Mills catalog. Book a video call to discuss.`
      : "Chandni Silk Mills — product catalog. Browse all designs.";
    const ctaHtml = file
      ? `<a class="cta" href="https://wa.me/919537097267?text=${encodeURIComponent("Hi Chandni Silk Mills! 👋 I saw design " + file + " (#" + designNum + ") in your catalog and I'd like to book a video call to discuss it.")}" target="_blank" rel="noopener">💬 Book a video call</a>`
      : `<a class="cta" href="https://chandni-catalog.pages.dev" target="_blank" rel="noopener">Browse catalog</a>`;
    const errorHtml = !file ? `<p class="error">Design not found.</p>` : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Chandni Silk Mills" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:width" content="600" />
<meta property="og:image:height" content="800" />
<meta property="og:url" content="${origin}/share.html?index=${designNum ? designNum - 1 : 0}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${imageUrl}" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%230d1117'/><text x='50' y='68' font-size='46' text-anchor='middle' fill='%2334d399' font-family='Arial' font-weight='bold'>CS</text></svg>" />
<style>
  :root { --bg: #0b0b0e; --accent: #34d399; --accent-2: #f5c451; --text: #eef2f7; --muted: #9aa7b8; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: grid; place-items: center; min-height: 100dvh; padding: 20px; }
  .card { max-width: 400px; width: 100%; text-align: center; }
  .card img { width: 100%; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
  .card h1 { font-size: 18px; margin-bottom: 6px; }
  .card p { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
  .cta { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #25D366, #128C7E); color: #fff; font-weight: 700; font-size: 15px; padding: 14px 24px; border-radius: 999px; text-decoration: none; box-shadow: 0 8px 28px rgba(37, 211, 102, 0.45); }
  .cta:hover { filter: brightness(1.08); }
  .error { color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<div class="card">
  ${errorHtml}
  ${file ? `<img src="${imageUrl}" alt="Design #${designNum}">` : ""}
  <h1>Chandni Silk Mills</h1>
  ${file ? `<p>Design #${designNum} of ${total}</p>` : ""}
  ${ctaHtml}
</div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500 });
  }
}
