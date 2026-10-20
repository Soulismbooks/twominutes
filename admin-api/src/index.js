/**
 * Dedicated twominutes.in Admin API.
 * Hosted only behind the verified Cloudflare Access hostname; workers_dev stays disabled.
 * Draft HTML is stored as data; this Worker never renders it.
 */
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
const MAX_BODY_BYTES = 1_000_000;
let jwksCache = { domain: null, expiresAt: 0, keys: null, pending: null };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function b64urlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

function normalizeTeamDomain(value) {
  if (typeof value !== "string") return null;
  const domain = value.trim().replace(/^https:\/\//i, "").replace(/\/$/, "").toLowerCase();
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) ? domain : null;
}

function safeSlug(value) {
  if (typeof value !== "string") return "";
  return value.trim().normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f-]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function parseDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "A JSON object is required." };
  const title = value.title ?? "";
  const rawSlug = value.slug ?? "";
  const summary = value.summary ?? "";
  const bodyHtml = value.body_html ?? "";
  const seoTitle = value.seo_title ?? "";
  const seoDescription = value.seo_description ?? "";
  const category = value.category ?? "Happy Life";
  const tags = value.tags ?? [];
  const featuredImage = value.featured_image ?? "";
  const featuredImageAlt = value.featured_image_alt ?? "";
  const allowedCategories = new Set(["Happy Life", "Money Tips", "Soulism"]);
  if (typeof title !== "string" || !title.trim() || title.length > 240 ||
      typeof rawSlug !== "string" || rawSlug.length > 240 ||
      typeof summary !== "string" || summary.length > 600 ||
      typeof bodyHtml !== "string" || bodyHtml.length > 500_000 ||
      typeof seoTitle !== "string" || seoTitle.length > 70 ||
      typeof seoDescription !== "string" || seoDescription.length > 160 ||
      typeof category !== "string" || !allowedCategories.has(category) ||
      !Array.isArray(tags) || tags.length > 20 ||
      tags.some((tag) => typeof tag !== "string" || tag.length > 60) ||
      typeof featuredImage !== "string" || featuredImage.length > 270_000 ||
      (featuredImage && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(featuredImage)) ||
      typeof featuredImageAlt !== "string" || featuredImageAlt.length > 180) {
    return { error: "One or more fields are invalid or exceed the allowed limit." };
  }
  const slug = safeSlug(rawSlug);
  if (!slug || slug.length > 140) return { error: "A valid slug is required." };
  return { data: { title: title.trim(), slug, summary: summary.trim(), body_html: bodyHtml,
    seo_title: seoTitle.trim(), seo_description: seoDescription.trim(), category,
    tags: tags.map((tag) => tag.trim()).filter(Boolean), featured_image: featuredImage,
    featured_image_alt: featuredImageAlt.trim() } };
}

function hasValidClaims(claims, teamDomain, audience, now = Math.floor(Date.now() / 1000)) {
  const aud = typeof claims?.aud === "string" ? [claims.aud] : claims?.aud;
  return claims && typeof claims === "object" &&
    claims.iss === `https://${teamDomain}` &&
    Array.isArray(aud) && aud.includes(audience) &&
    Number.isFinite(claims.exp) && claims.exp > now &&
    (claims.nbf === undefined || (Number.isFinite(claims.nbf) && claims.nbf <= now)) &&
    (claims.iat === undefined || (Number.isFinite(claims.iat) && claims.iat <= now + 60));
}

async function getAccessKeys(teamDomain) {
  const now = Date.now();
  if (jwksCache.domain === teamDomain && jwksCache.keys && jwksCache.expiresAt > now) return jwksCache.keys;
  if (jwksCache.domain === teamDomain && jwksCache.pending) return jwksCache.pending;

  const pending = (async () => {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error("Access keys unavailable");
    const set = await response.json();
    if (!Array.isArray(set.keys)) throw new Error("Access keys invalid");
    const keys = set.keys.filter((key) => key && key.kty === "RSA" &&
      typeof key.kid === "string" && typeof key.n === "string" && typeof key.e === "string");
    if (keys.length === 0) throw new Error("No valid Access keys");
    const cacheControl = response.headers.get("cache-control") || "";
    const match = cacheControl.match(/max-age=(\d+)/i);
    const ttl = Math.max(30, Math.min(match ? Number(match[1]) : 300, 900));
    jwksCache = { domain: teamDomain, keys, expiresAt: Date.now() + ttl * 1000, pending: null };
    return keys;
  })();

  jwksCache = { ...jwksCache, domain: teamDomain, pending };
  try {
    return await pending;
  } catch {
    if (jwksCache.pending === pending) jwksCache = { domain: null, expiresAt: 0, keys: null, pending: null };
    throw new Error("Access keys unavailable");
  }
}

async function verifyAccessJwt(token, env) {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = typeof env.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  if (!teamDomain || !audience || typeof token !== "string" || token.length > 20_000) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;

  let header, claims, signature;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
    signature = b64urlToBytes(parts[2]);
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || typeof header.kid !== "string" || header.crit !== undefined) return null;
  if (!hasValidClaims(claims, teamDomain, audience)) return null;

  try {
    let keys = await getAccessKeys(teamDomain);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      // A kid miss may be key rotation: refresh once, then fail closed.
      jwksCache = { domain: null, expiresAt: 0, keys: null, pending: null };
      keys = await getAccessKeys(teamDomain);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    return verified ? claims : null;
  } catch {
    return null;
  }
}

async function readJsonBody(request) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { error: "Request body too large." };
  }
  if (!request.body) return { error: "Request body is required." };
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "Request body too large." };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "Invalid JSON request body." };
  }
}

function configuredOriginIsValid(env) {
  if (typeof env.ADMIN_ORIGIN !== "string" || !env.ADMIN_ORIGIN) return false;
  try {
    const parsed = new URL(env.ADMIN_ORIGIN);
    return parsed.protocol === "https:" && parsed.origin === env.ADMIN_ORIGIN;
  } catch {
    return false;
  }
}

function originAllowed(request, env) {
  if (!configuredOriginIsValid(env)) return false;
  const supplied = request.headers.get("Origin");
  return supplied === env.ADMIN_ORIGIN;
}

function safeError() {
  return json({ error: "The request could not be completed." }, 500);
}

export { normalizeTeamDomain, safeSlug, parseDraft, hasValidClaims, verifyAccessJwt, readJsonBody, originAllowed };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originOK = originAllowed(request, env);
    const cors = originOK ? {
      "access-control-allow-origin": new URL(env.ADMIN_ORIGIN).origin,
      "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
      "access-control-allow-headers": "content-type",
      "vary": "Origin",
    } : {};

    if (request.method === "OPTIONS") {
      if (!originOK) return json({ error: "Forbidden origin." }, 403);
      return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...cors } });
    }
    if (!["GET", "POST", "PUT", "PATCH"].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, PUT, PATCH" });
    }
    if (request.method !== "GET" && !originOK) return json({ error: "Forbidden origin." }, 403);
    if (!env.DB || typeof env.ADMIN_EMAIL !== "string" ||
        !normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN) ||
        typeof env.ACCESS_AUD !== "string" || !env.ACCESS_AUD.trim() ||
        !configuredOriginIsValid(env)) {
      return json({ error: "Admin API is not configured." }, 503);
    }

    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!assertion) return json({ error: "Authentication required." }, 401, cors);
    const claims = await verifyAccessJwt(assertion, env);
    if (!claims) return json({ error: "Invalid Access identity." }, 401, cors);
    if (typeof claims.email !== "string" || claims.email !== env.ADMIN_EMAIL) {
      return json({ error: "Forbidden." }, 403, cors);
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "twominutes-admin-api" }, 200, cors);
      }
      if (url.pathname === "/api/drafts" && request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT id, title, slug, summary, seo_title, seo_description, category, tags, featured_image_alt, status, created_at, updated_at FROM admin_drafts ORDER BY updated_at DESC LIMIT 100"
        ).all();
        return json({ drafts: result.results ?? [] }, 200, cors);
      }
      if (url.pathname === "/api/drafts" && request.method === "POST") {
        const body = await readJsonBody(request);
        if (body.error) return json({ error: body.error }, 400, cors);
        const parsed = parseDraft(body.value);
        if (parsed.error) return json({ error: parsed.error }, 400, cors);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        try {
          await env.DB.prepare(
            "INSERT INTO admin_drafts (id, title, slug, summary, body_html, seo_title, seo_description, category, tags, featured_image, featured_image_alt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
          ).bind(id, parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, parsed.data.seo_title, parsed.data.seo_description, parsed.data.category, JSON.stringify(parsed.data.tags), parsed.data.featured_image, parsed.data.featured_image_alt, now, now).run();
        } catch (error) {
          if (String(error?.message || error).toLowerCase().includes("unique")) {
            return json({ error: "This slug is already in use." }, 409, cors);
          }
          return safeError();
        }
        return json({ id, status: "draft", created_at: now, updated_at: now }, 201, cors);
      }
      const reviewMatch = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})\/review$/i);
      if (reviewMatch && request.method === "PATCH") {
        const reviewId = reviewMatch[1];
        if (!reviewId) return json({ error: "Draft not found." }, 404, cors);
        const review = await env.DB.prepare(
          "UPDATE admin_drafts SET status = 'ready_for_review', updated_at = ? WHERE id = ? AND status = 'draft'"
        ).bind(new Date().toISOString(), reviewId).run();
        if (!review.meta?.changes) return json({ error: "Draft not found or already sent for review." }, 404, cors);
        return json({ id: reviewId, status: "ready_for_review", message: "Draft marked for review; nothing has been published." }, 200, cors);
      }
      const match = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})$/i);
      if (match && request.method === "GET") {
        const draft = await env.DB.prepare(
          "SELECT id, title, slug, summary, body_html, seo_title, seo_description, category, tags, featured_image, featured_image_alt, status, created_at, updated_at FROM admin_drafts WHERE id = ?"
        ).bind(match[1]).first();
        return draft ? json({ draft }, 200, cors) : json({ error: "Draft not found." }, 404, cors);
      }
      if (match && request.method === "PUT")
        const body = await readJsonBody(request);
        if (body.error) return json({ error: body.error }, 400, cors);
        const parsed = parseDraft(body.value);
        if (parsed.error) return json({ error: parsed.error }, 400, cors);
        const now = new Date().toISOString();
        try {
          const result = await env.DB.prepare(
            "UPDATE admin_drafts SET title = ?, slug = ?, summary = ?, body_html = ?, seo_title = ?, seo_description = ?, category = ?, tags = ?, featured_image = ?, featured_image_alt = ?, updated_at = ? WHERE id = ?"
          ).bind(parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, parsed.data.seo_title, parsed.data.seo_description, parsed.data.category, JSON.stringify(parsed.data.tags), parsed.data.featured_image, parsed.data.featured_image_alt, now, match[1]).run();
          if (!result.meta?.changes) return json({ error: "Draft not found." }, 404, cors);
        } catch (error) {
          if (String(error?.message || error).toLowerCase().includes("unique")) {
            return json({ error: "This slug is already in use." }, 409, cors);
          }
          return safeError();
        }
        return json({ id: match[1], status: "draft", updated_at: now }, 200, cors);
      }
      return json({ error: "Not found." }, 404, cors);
    } catch {
      return safeError();
    }
  },
};
