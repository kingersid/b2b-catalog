// Chandni Silk Mills catalog — iPhone upload endpoint (Pages Function).
//
//   POST /api/upload   multipart/form-data:
//     key      -> must equal the UPLOAD_KEY secret (wrangler pages secret put UPLOAD_KEY)
//     files    -> one or more images. Each file field carries:
//                 - blob bytes (the optimized JPG/WebP produced client-side)
//                 - form fields sent alongside (see upload.html): name, path
//     meta     -> JSON array [{ name, path }, ...] matching the file order
//
// What it does (mirrors scripts/add-from-gphotos.mjs):
//   1. Verifies the shared key (only the owner can upload).
//   2. Commits the image files + regenerated FILES arrays (index.html,
//      media.js, functions/share.js) to the repo's main branch in ONE commit.
//   3. GitHub Actions auto-deploys to Cloudflare Pages (~2 min).
//
// Required secrets (set once):
//   npx wrangler pages secret put UPLOAD_KEY
//   npx wrangler pages secret put GITHUB_TOKEN   (fine-grained token: Contents RW on kingersid/b2b-catalog)

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

const REPO = "kingersid/b2b-catalog";
const BRANCH = "main";
const LIST_FILES = [
  { path: "index.html", marker: "const FILES = [" },
  { path: "media.js", marker: "window.CATALOG_FILES = [" },
  { path: "functions/share.js", marker: "const FILES = [" },
];

function gh(token, path, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "chandni-catalog-upload",
      ...(opts.headers || {}),
    },
  });
}

// Insert `"filename"` before the closing ] of the FILES array (same logic as add-from-gphotos.mjs).
function addToFileArray(content, filename) {
  const entry = `"${filename}"`;
  if (content.includes(filename)) return null;
  const filesIdx = content.indexOf("const FILES = [");
  const start = content.indexOf("[", filesIdx);
  let depth = 0, arrayEnd = -1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "[") depth++;
    if (content[i] === "]") depth--;
    if (depth === 0) { arrayEnd = i; break; }
  }
  if (arrayEnd === -1) throw new Error("FILES array not found");
  const before = content.slice(0, arrayEnd).trimEnd();
  return before + ",\n    " + entry + "\n  " + content.slice(arrayEnd);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const token = env.GITHUB_TOKEN;
  const expectedKey = env.UPLOAD_KEY;
  if (!token) return json({ error: "GITHUB_TOKEN not configured" }, 503);
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

  const metaRaw = form.get("meta");
  let meta;
  try {
    meta = JSON.parse(String(metaRaw || "[]"));
  } catch {
    return json({ error: "Bad meta" }, 400);
  }

  const uploads = [];
  for (const m of meta) {
    const file = form.get(m.field);
    if (!(file instanceof File)) return json({ error: `Missing file ${m.field}` }, 400);
    // Allowed destinations: root JPG originals + mid/ and webp/ WebP variants
    if (!/^[\w-]+\.jpg$/i.test(m.path) && !/^(mid|webp)\/[\w-]+\.webp$/i.test(m.path))
      return json({ error: `Bad destination path ${m.path}` }, 400);
    uploads.push({ name: m.path.split("/").pop(), path: m.path, bytes: await file.arrayBuffer() });
  }
  if (!uploads.length) return json({ error: "No files" }, 400);

  // The catalog list only contains original filenames (JPGs)
  const jpgNames = [...new Set(uploads.filter((u) => /\.jpg$/i.test(u.path)).map((u) => u.name))];

  try {
    // 1. Current branch head
    const refResp = await gh(token, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    if (!refResp.ok) return json({ error: "Cannot read branch ref: " + refResp.status }, 500);
    const baseSha = (await refResp.json()).object.sha;

    const commitResp = await gh(token, `/repos/${REPO}/commits/${baseSha}`);
    const baseTree = (await commitResp.json()).tree.sha;

    // 2. Create blobs for the images
    const tree = [];
    for (const u of uploads) {
      const blobResp = await gh(token, `/repos/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: b64(u.bytes), encoding: "base64" }),
      });
      if (!blobResp.ok) return json({ error: `Blob failed for ${u.name}: ${blobResp.status}` }, 500);
      tree.push({ path: u.path, mode: "100644", type: "blob", sha: (await blobResp.json()).sha });
    }

    // 3. Update the FILES arrays so the catalog picks up the new designs
    for (const lf of LIST_FILES) {
      const rawResp = await gh(token, `/repos/${REPO}/contents/${lf.path}?ref=${BRANCH}`);
      if (!rawResp.ok) continue; // skip missing file rather than fail the whole upload
      const current = Buffer.from(await rawResp.arrayBuffer()).toString("utf8");
      // Add every new JPG filename to the array (variants share stems, so only JPGs are listed)
      let content = current;
      let changed = false;
      for (const name of jpgNames) {
        const updated = addToFileArray(content, name);
        if (updated) { content = updated; changed = true; }
      }
      if (!changed) continue;
      const blobResp = await gh(token, `/repos/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" }),
      });
      if (blobResp.ok) tree.push({ path: lf.path, mode: "100644", type: "blob", sha: (await blobResp.json()).sha });
    }

    // 4. One commit with everything
    const treeResp = await gh(token, `/repos/${REPO}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });
    if (!treeResp.ok) return json({ error: "Tree failed: " + treeResp.status }, 500);
    const newTree = (await treeResp.json()).sha;

    const newCommitResp = await gh(token, `/repos/${REPO}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Add ${uploads.length} design(s) via iPhone upload`,
        tree: newTree,
        parents: [baseSha],
      }),
    });
    if (!newCommitResp.ok) return json({ error: "Commit failed: " + newCommitResp.status }, 500);
    const newCommit = (await newCommitResp.json()).sha;

    const pushResp = await gh(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit }),
    });
    if (!pushResp.ok) return json({ error: "Push failed: " + pushResp.status }, 500);

    return json({ ok: true, commit: newCommit.slice(0, 7), added: uploads.map((u) => u.name) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function b64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
