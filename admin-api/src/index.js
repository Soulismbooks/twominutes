/**
 * twominutes.in dedicated Admin API.
 *
 * Fail-closed: requires Cloudflare Access JWT and exact admin email.
 * This worker must stay unbound from any public hostname until an Access
 * application protects its endpoint. Draft HTML is stored as data only and
 * is never executed or rendered here.
 */
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function b64urlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function verifyAccessJwt(token, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const chunks = token.split(".");
  if (chunks.length !== 3) return null;

  let header;
  let claims;
  try {
    header = decodePart(chunks[0]);
    claims = decodePart(chunks[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer || !Array.isArray(claims.aud) ||
      !claims.aud.includes(env.ACCESS_AUD) ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now)) {
    return null;
  }

  let certs;
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!response.ok) return null;
    certs = await response.json();
  } catch {
    return null;
  }
  const jwk = certs.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const signed = new TextEncoder().encode(`${chunks[0]}.${chunks[1]}`);
    const signature = b64urlToBytes(chunks[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
    return valid ? claims : null;
  } catch {
    return null;
  }
}

function sameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return Boolean(env.ADMIN_ORIGIN && origin === env.ADMIN_ORIGIN);
}

function requireOriginForMutation(request, env) {
  return sameOrigin(request, env);
}

function safeSlug(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\u0900-\u097f-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);
}

function validText(value, max) {
  return typeof value === "string" && value.length <= max;
}

async function readDraftBody(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 1_000_000) return { error: "Request body too large." };
  let value;
  try {
    value = await request.json();
  } catch {
    return { error: "Invalid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "JSON object required." };
  }
  if (!validText(value.title ?? "", 240) ||
      !validText(value.summary ?? "", 600) ||
      !validText(value.body_html ?? "", 500_000)) {
    return { error: "One or more fields exceed allowed limits." };
  }
  const slug = safeSlug(value.slug ?? "");
  if ((value.slug ?? "") !== "" && !slug) return { error: "Invalid slug." };
  return {
    data: {
      title: (value.title ?? "").trim(),
      slug,
      summary: (value.summary ?? "").trim(),
      body_html: value.body_html ?? "",
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = sameOrigin(request, env) && origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
          "access-control-allow-headers": "content-type",
          "vary": "Origin",
        }
      : {};

    if (request.method === "OPTIONS") {
      if (!sameOrigin(request, env)) return json({ error: "Forbidden" }, 403);
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!["GET", "POST", "PUT"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405, { allow: "GET, POST, PUT" });
    }
    if (request.method !== "GET" && !requireOriginForMutation(request, env)) {
      return json({ error: "Forbidden origin" }, 403, corsHeaders);
    }

    if (!env.DB || !env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN || !env.ADMIN_EMAIL) {
      return json({ error: "Admin API is not configured." }, 503, corsHeaders);
    }

    const authHeader = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!authHeader) return json({ error: "Authentication required" }, 401, corsHeaders);
    const claims = await verifyAccessJwt(authHeader, env);
    if (!claims) return json({ error: "Invalid Access identity" }, 401, corsHeaders);

    const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
    if (email !== env.ADMIN_EMAIL.toLowerCase()) {
      return json({ error: "Forbidden" }, 403, corsHeaders);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "twominutes-admin-api" }, 200, corsHeaders);
    }

    if (url.pathname === "/api/drafts" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, title, slug, summary, status, created_at, updated_at FROM admin_drafts ORDER BY updated_at DESC LIMIT 100"
      ).all();
      return json({ drafts: rows.results ?? [] }, 200, corsHeaders);
    }

    if (url.pathname === "/api/drafts" && request.method === "POST") {
      const parsed = await readDraftBody(request);
      if (parsed.error) return json({ error: parsed.error }, 400, corsHeaders);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          "INSERT INTO admin_drafts (id, title, slug, summary, body_html, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)"
        ).bind(id, parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, now, now).run();
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) {
          return json({ error: "That slug is already in use." }, 409, corsHeaders);
        }
        throw error;
      }
      return json({ id, status: "draft", created_at: now, updated_at: now }, 201, corsHeaders);
    }

    const match = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})$/i);
    if (match && request.method === "GET") {
      const draft = await env.DB.prepare(
        "SELECT id, title, slug, summary, body_html, status, created_at, updated_at FROM admin_drafts WHERE id = ?"
      ).bind(match[1]).first();
      return draft ? json({ draft }, 200, corsHeaders) : json({ error: "Draft not found" }, 404, corsHeaders);
    }

    if (match && request.method === "PUT") {
      const parsed = await readDraftBody(request);
      if (parsed.error) return json({ error: parsed.error }, 400, corsHeaders);
      const now = new Date().toISOString();
      try {
        const result = await env.DB.prepare(
          "UPDATE admin_drafts SET title = ?, slug = ?, summary = ?, body_html = ?, updated_at = ? WHERE id = ?"
        ).bind(parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, now, match[1]).run();
        if (!result.meta?.changes) return json({ error: "Draft not found" }, 404, corsHeaders);
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) {
          return json({ error: "That slug is already in use." }, 409, corsHeaders);
        }
        throw error;
      }
      return json({ id: match[1], status: "draft", updated_at: now }, 200, corsHeaders);
    }

    return json({ error: "Not found" }, 404, corsHeaders);
  },
};
