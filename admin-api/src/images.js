/**
 * Private R2 image helpers for the Admin API.
 * Caller must run after Access JWT verification and origin checks.
 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", { ext: "jpg", signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ["image/png", { ext: "png", signature: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a }],
  ["image/webp", { ext: "webp", signature: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0,4)) === "RIFF" && String.fromCharCode(...b.slice(8,12)) === "WEBP" }],
]);

function fail(status, error) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function sniffType(bytes) {
  for (const [type, rule] of ALLOWED_TYPES) {
    if (rule.signature(bytes)) return { type, ext: rule.ext };
  }
  return null;
}

function validDraftId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Route handler. It must only be called from the authenticated section of index.js.
 * Keys never come directly from the client and the bucket must not have public access enabled.
 */
export async function handleImageRequest(request, url, env) {
  if (!env.IMAGES) return fail(503, "Private image storage is not configured.");
  if (request.method === "POST" && url.pathname === "/api/images") {
    const draftId = url.searchParams.get("draft");
    if (!validDraftId(draftId)) return fail(400, "A valid saved draft ID is required.");
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) return fail(415, "Only JPEG, PNG, and WebP images are allowed.");
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) return fail(413, "Image exceeds the 6 MiB upload limit.");
    if (!request.body) return fail(400, "Image body is required.");
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return fail(413, "Image exceeds the 6 MiB upload limit.");
        }
        chunks.push(value);
      }
    } catch {
      return fail(400, "Could not read image body.");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const detected = sniffType(bytes);
    if (!detected || detected.type !== contentType) return fail(415, "Image content does not match the declared image type.");
    const key = `drafts/${draftId}/${crypto.randomUUID()}.${detected.ext}`;
    try {
      await env.IMAGES.put(key, bytes, {
        httpMetadata: { contentType: detected.type, cacheControl: "private, no-store" },
        customMetadata: { draftId, scope: "admin-draft-image" }
      });
      return Response.json({ key, url: `/api/images/${key}`, type: detected.type, size }, {
        status: 201,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
      });
    } catch {
      return fail(502, "Image storage operation failed.");
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/images/")) {
    const key = url.pathname.slice("/api/images/".length);
    // Prevent traversal/encoded path ambiguity; keys are the exact generated structure.
    if (!/^drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(key)) {
      return fail(404, "Image not found.");
    }
    try {
      const object = await env.IMAGES.get(key);
      if (!object || !object.httpMetadata?.contentType || !ALLOWED_TYPES.has(object.httpMetadata.contentType)) return fail(404, "Image not found.");
      const headers = new Headers({
        "content-type": object.httpMetadata.contentType,
        "content-length": String(object.size),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      return new Response(object.body, { status: 200, headers });
    } catch {
      return fail(502, "Image storage operation failed.");
    }
  }
  return null;
}

export { MAX_IMAGE_BYTES, sniffType, validDraftId };
