// Chandni Silk Mills catalog — R2 image proxy (Pages Function).
//
//   GET /designs/original/{id}.jpg
//   GET /designs/mid/{id}.webp
//   GET /designs/webp/{id}.webp
//
// Serves images from R2 with long-lived immutable caching. R2 is not
// publicly accessible by default, so this proxy is the public face.

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);

  // Path: /designs/{size}/{id}.ext
  const parts = url.pathname.split("/");
  // ["", "designs", "original", "id.jpg"]
  if (parts.length < 4) return new Response("Not found", { status: 404 });

  const size = parts[2]; // original | mid | webp
  const filename = parts[3];

  const validSizes = ["original", "mid", "webp"];
  if (!validSizes.includes(size)) return new Response("Invalid size", { status: 400 });

  const key = `designs/${size}/${filename}`;
  const object = await env.DESIGNS_BUCKET.get(key);

  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");

  return new Response(object.body, { headers });
}
