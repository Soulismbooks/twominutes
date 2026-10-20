/**
 * Dedicated twominutes.in Admin API.
 * Keep workers_dev=false and add no route until a dedicated Access app/policy
 * is verified. Draft HTML is stored as data; this Worker never renders it.
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
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
  const category = value.category ?? "";
  const tags = value.tags ?? [];
  const featuredImageUrl = value.featured_image_url ?? "";
  const featuredImageAlt = value.featured_image_alt ?? "";
  const canonicalUrl = value.canonical_url ?? "";
  if (typeof title !== "string" || !title.trim() || title.length > 240 ||
      typeof rawSlug !== "string" || rawSlug.length > 240 ||
      typeof summary !== "string" || summary.length > 600 ||
      typeof bodyHtml !== "string" || bodyHtml.length > 500_000 ||
      typeof seoTitle !== "string" || seoTitle.length > 240 ||
      typeof seoDescription !== "string" || seoDescription.length > 320 ||
      typeof category !== "string" || category.length > 100 ||
      !Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== "string" || tag.length > 60) ||
      typeof featuredImageUrl !== "string" || featuredImageUrl.length > 2000 ||
      typeof featuredImageAlt !== "string" || featuredImageAlt.length > 300 ||
      typeof canonicalUrl !== "string" || canonicalUrl.length > 500) {
    return { error: "One or more fields are invalid or exceed the allowed limit." };
  }
  for (const candidate of [featuredImageUrl, canonicalUrl]) {
    if (candidate) {
      try { const parsed = new URL(candidate); if (parsed.protocol !== "https:") return { error: "Image and canonical URLs must use HTTPS." }; }
      catch { return { error: "Image and canonical URLs must be valid HTTPS URLs." }; }
    }
  }
  const slug = safeSlug(rawSlug);
  if (!slug || slug.length > 140) return { error: "A valid slug is required." };
  return { data: { title: title.trim(), slug, summary: summary.trim(), body_html: bodyHtml, seo_title: seoTitle.trim(), seo_description: seoDescription.trim(), category: category.trim(), tags, featured_image_url: featuredImageUrl.trim(), featured_image_alt: featuredImageAlt.trim(), canonical_url: canonicalUrl.trim() } };
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

const GITHUB_REPO = "Soulismbooks/twominutes";
const GITHUB_OWNER = "Soulismbooks";
const GITHUB_DEFAULT_BRANCH = "main";

function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\x27/g, "&apos;");
}

function sanitizePublishedHtml(value) {
  return String(value ?? "")
    .replace(/<(script|iframe|object|embed|form|input|button|textarea|select|option|base|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|input|button|textarea|select|option|base|meta|link)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27|[^\s>]+)/gi, "")
    .replace(/\s+(href|src|xlink:href)\s*=\s*(["\x27])\s*(?:javascript|vbscript|data\s*:\s*text\/html)[\s\S]*?\2/gi, " $1=\"#\"");
}

function buildAtomEntry(draft, publishedAt = new Date().toISOString()) {
  const slug = safeSlug(draft.slug);
  if (!slug) throw new Error("A valid slug is required before publishing.");
  const title = String(draft.title || "").trim();
  if (!title) throw new Error("A title is required before publishing.");
  const summary = String(draft.summary || draft.seo_description || "").trim();
  const featuredUrl = String(draft.featured_image_url || "").trim();
  const featuredAlt = String(draft.featured_image_alt || "").trim();
  const canonicalUrl = String(draft.canonical_url || "").trim();
  const seoTitle = String(draft.seo_title || "").trim();
  const seoDescription = String(draft.seo_description || "").trim();
  const bodyHtml = sanitizePublishedHtml(String(draft.body_html || ""));
  const labels = [...new Set([draft.category, ...(Array.isArray(draft.tags) ? draft.tags : [])].map(v => String(v || "").trim()).filter(Boolean))].slice(0, 30);
  const categories = labels.map(label => `<category term="${xmlEscape(label)}" />`).join("\n");
  const permalink = `https://www.twominutes.in/${encodeURIComponent(slug)}.html`;
  const identity = String(draft.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, "");
  return [
    "  <entry>",
    `    <id>tag:twominutes.in,2026:admin-post-${xmlEscape(identity)}</id>`,
    `    <title>${xmlEscape(title)}</title>`,
    `    <published>${publishedAt}</published>`,
    `    <updated>${publishedAt}</updated>`,
    `    <link rel="alternate" type="text/html" href="${xmlEscape(permalink)}" />`,
    `    <summary type="text">${xmlEscape(summary)}</summary>`,
    `    <content type="html">${xmlEscape(bodyHtml)}</content>`,
    "    <blogger:type>POST</blogger:type>",
    "    <blogger:status>LIVE</blogger:status>",
    `    <blogger:filename>${xmlEscape(slug + ".html")}</blogger:filename>`,
    `    <blogger:seo-title>${xmlEscape(seoTitle)}</blogger:seo-title>`,
    `    <blogger:seo-description>${xmlEscape(seoDescription)}</blogger:seo-description>`,
    `    <blogger:canonical-url>${xmlEscape(canonicalUrl)}</blogger:canonical-url>`,
    `    <blogger:featured-image-url>${xmlEscape(featuredUrl)}</blogger:featured-image-url>`,
    `    <blogger:featured-image-alt>${xmlEscape(featuredAlt)}</blogger:featured-image-alt>`,
    categories ? "    " + categories : "",
    "  </entry>"
  ].filter(Boolean).join("\n");
}

function appendAtomEntry(feed, entry, slug) {
  if (typeof feed !== "string" || !feed.includes("xmlns:blogger=") || !/<\/feed\s*>\s*$/i.test(feed)) {
    throw new Error("The current feed.atom format could not be safely updated.");
  }
  const target = `${safeSlug(slug)}.html`;
  const filenameMatches = feed.matchAll(/<blogger:filename>\s*([\s\S]*?)\s*<\/blogger:filename>/gi);
  for (const match of filenameMatches) {
    const filename = match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (filename.toLowerCase() === target.toLowerCase()) {
      const error = new Error("This post URL already exists in feed.atom.");
      error.status = 409;
      throw error;
    }
  }
  const closeIndex = feed.toLowerCase().lastIndexOf("</feed>");
  if (closeIndex < 0) throw new Error("Could not find feed.atom closing tag.");
  return feed.slice(0, closeIndex) + "\n" + entry + "\n" + feed.slice(closeIndex);
}

async function githubRequest(token, path, method = "GET", body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "twominutes-admin-portal"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  if (!response.ok) {
    const error = new Error("GitHub API request failed with status " + response.status);
    error.status = response.status;
    throw error;
  }
  return value;
}

async function createPublicationPullRequest(draft, env) {
  const token = typeof env.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : "";
  if (!token) {
    const error = new Error("Publishing is not configured yet. Add a repository-scoped GITHUB_TOKEN secret to the Admin API Worker.");
    error.status = 503;
    throw error;
  }
  const safeId = String(draft.id || "").replace(/[^a-f0-9-]/gi, "");
  const branch = "admin-publish-" + safeId.replace(/-/g, "").slice(0, 16);
  const headFilter = encodeURIComponent(`${GITHUB_OWNER}:${branch}`);
  const existing = await githubRequest(token, `/repos/${GITHUB_REPO}/pulls?state=all&head=${headFilter}&base=${GITHUB_DEFAULT_BRANCH}`);
  if (Array.isArray(existing) && existing.length) {
    const item = existing[0];
    if (item.html_url && item.number) return { pull_request_url: item.html_url, pull_request_number: item.number, status: item.state === "open" ? "ready_for_review" : "pull_request_exists" };
  }
  const mainRef = await githubRequest(token, `/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`);
  const mainSha = mainRef?.object?.sha;
  if (!mainSha) throw new Error("Could not resolve the repository base revision.");
  const mainCommit = await githubRequest(token, `/repos/${GITHUB_REPO}/git/commits/${mainSha}`);
  const treeSha = mainCommit?.tree?.sha;
  if (!treeSha) throw new Error("Could not resolve the repository tree.");
  const rawResponse = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/${mainSha}/feed.atom`, { signal: AbortSignal.timeout(20000) });
  if (!rawResponse.ok) throw new Error("Could not read the current publication feed.");
  const feed = await rawResponse.text();
  if (feed.length > 8_000_000) throw new Error("feed.atom is larger than the safe publication limit.");
  const entry = buildAtomEntry(draft);
  const newFeed = appendAtomEntry(feed, entry, draft.slug);
  const refPath = `/repos/${GITHUB_REPO}/git/refs/heads/${branch}`;
  try {
    await githubRequest(token, `/repos/${GITHUB_REPO}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: mainSha });
  } catch {
    // A failed/retried request may have left the draft branch behind. Reuse it only after resetting to the exact main revision.
    await githubRequest(token, refPath, "PATCH", { sha: mainSha, force: true });
  }
  const blob = await githubRequest(token, `/repos/${GITHUB_REPO}/git/blobs`, "POST", { content: newFeed, encoding: "utf-8" });
  const newTree = await githubRequest(token, `/repos/${GITHUB_REPO}/git/trees`, "POST", {
    base_tree: treeSha, tree: [{ path: "feed.atom", mode: "100644", type: "blob", sha: blob.sha }]
  });
  const newCommit = await githubRequest(token, `/repos/${GITHUB_REPO}/git/commits`, "POST", {
    message: `Admin Portal: publish draft ${safeSlug(draft.slug)}`, tree: newTree.sha, parents: [mainSha]
  });
  await githubRequest(token, refPath, "PATCH", { sha: newCommit.sha, force: false });
  const prTitle = ("Publish: " + String(draft.title || "New post").replace(/\s+/g, " ")).slice(0, 120);
  const prBody = [
    "## Admin Portal publication review",
    "",
    "This PR adds one reviewed Admin Portal post to `feed.atom`. The existing build workflow will regenerate the public site only after this PR is reviewed and merged.",
    "",
    `- **Title:** ${String(draft.title || "").replace(/\r?\n/g, " ")}`,
    `- **Slug:** ${safeSlug(draft.slug)}.html`,
    `- **Category:** ${String(draft.category || "Uncategorized").replace(/\r?\n/g, " ")}`,
    `- **SEO title:** ${String(draft.seo_title || draft.title || "").replace(/\r?\n/g, " ")}`,
    "",
    "Nothing is published by creating this PR. Merge is a separate approval step. The article HTML is filtered to remove script-capable elements and event-handler attributes before it enters the public feed."
  ].join("\n");
  const pr = await githubRequest(token, `/repos/${GITHUB_REPO}/pulls`, "POST", { title: prTitle, head: branch, base: GITHUB_DEFAULT_BRANCH, body: prBody, maintainer_can_modify: false });
  if (!pr?.html_url || !pr?.number) throw new Error("GitHub did not return the created Pull Request.");
  return { pull_request_url: pr.html_url, pull_request_number: pr.number, status: "ready_for_review" };
}

function safeError() {
  return json({ error: "The request could not be completed." }, 500);
}

export { normalizeTeamDomain, safeSlug, parseDraft, hasValidClaims, verifyAccessJwt, readJsonBody, originAllowed, xmlEscape, sanitizePublishedHtml, buildAtomEntry, appendAtomEntry };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originOK = originAllowed(request, env);
    const cors = originOK ? {
      "access-control-allow-origin": new URL(env.ADMIN_ORIGIN).origin,
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "content-type, x-image-content-type",
      "vary": "Origin",
    } : {};

    if (request.method === "OPTIONS") {
      if (!originOK) return json({ error: "Forbidden origin." }, 403);
      return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...cors } });
    }
    if (!["GET", "POST", "PUT"].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, PUT" });
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
          "SELECT id, title, slug, summary, seo_title, seo_description, category, tags_json, featured_image_url, featured_image_alt, canonical_url, github_pr_url, github_pr_number, status, created_at, updated_at FROM admin_drafts ORDER BY updated_at DESC LIMIT 100"
        ).all();
        return json({ drafts: (result.results ?? []).map(row => { try { row.tags = JSON.parse(row.tags_json || "[]"); } catch { row.tags = []; } return row; }) }, 200, cors);
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
            "INSERT INTO admin_drafts (id, title, slug, summary, body_html, seo_title, seo_description, category, tags_json, featured_image_url, featured_image_alt, canonical_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
          ).bind(id, parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, parsed.data.seo_title, parsed.data.seo_description, parsed.data.category, JSON.stringify(parsed.data.tags), parsed.data.featured_image_url, parsed.data.featured_image_alt, parsed.data.canonical_url, now, now).run();
        } catch (error) {
          if (String(error?.message || error).toLowerCase().includes("unique")) {
            return json({ error: "This slug is already in use." }, 409, cors);
          }
          return safeError();
        }
        return json({ id, status: "draft", created_at: now, updated_at: now }, 201, cors);
      }
      const match = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})$/i);
      if (match && request.method === "GET") {
        const draft = await env.DB.prepare(
          "SELECT id, title, slug, summary, body_html, seo_title, seo_description, category, tags_json, featured_image_url, featured_image_alt, canonical_url, github_pr_url, github_pr_number, status, created_at, updated_at FROM admin_drafts WHERE id = ?"
        ).bind(match[1]).first();
        if (!draft) return json({ error: "Draft not found." }, 404, cors);
        try { draft.tags = JSON.parse(draft.tags_json || "[]"); } catch { draft.tags = []; }
        return json({ draft }, 200, cors);
      }
      if (match && request.method === "PUT") {
        const body = await readJsonBody(request);
        if (body.error) return json({ error: body.error }, 400, cors);
        const parsed = parseDraft(body.value);
        if (parsed.error) return json({ error: parsed.error }, 400, cors);
        const now = new Date().toISOString();
        try {
          const result = await env.DB.prepare(
            "UPDATE admin_drafts SET title = ?, slug = ?, summary = ?, body_html = ?, seo_title = ?, seo_description = ?, category = ?, tags_json = ?, featured_image_url = ?, featured_image_alt = ?, canonical_url = ?, updated_at = ? WHERE id = ?"
          ).bind(parsed.data.title, parsed.data.slug, parsed.data.summary, parsed.data.body_html, parsed.data.seo_title, parsed.data.seo_description, parsed.data.category, JSON.stringify(parsed.data.tags), parsed.data.featured_image_url, parsed.data.featured_image_alt, parsed.data.canonical_url, now, match[1]).run();
          if (!result.meta?.changes) return json({ error: "Draft not found." }, 404, cors);
        } catch (error) {
          if (String(error?.message || error).toLowerCase().includes("unique")) {
            return json({ error: "This slug is already in use." }, 409, cors);
          }
          return safeError();
        }
        return json({ id: match[1], status: "draft", updated_at: now }, 200, cors);
      }
      const publishMatch = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})\/publish$/i);
      if (publishMatch && request.method === "POST") {
        const draft = await env.DB.prepare(
          "SELECT id, title, slug, summary, body_html, seo_title, seo_description, category, tags_json, featured_image_url, featured_image_alt, canonical_url, github_pr_url, github_pr_number, status FROM admin_drafts WHERE id = ?"
        ).bind(publishMatch[1]).first();
        if (!draft) return json({ error: "Draft not found." }, 404, cors);
        if (draft.github_pr_url) return json({ id: draft.id, pull_request_url: draft.github_pr_url, pull_request_number: draft.github_pr_number, status: draft.status, existing: true }, 200, cors);
        try { draft.tags = JSON.parse(draft.tags_json || "[]"); } catch { draft.tags = []; }
        let publication;
        try {
          publication = await createPublicationPullRequest(draft, env);
        } catch (error) {
          if (error && error.status === 409) return json({ error: error.message }, 409, cors);
          if (error && error.status === 503) return json({ error: error.message }, 503, cors);
          return json({ error: "Could not create the GitHub publication PR. Check the Admin API GitHub secret and repository permissions, then retry." }, 502, cors);
        }
        const now = new Date().toISOString();
        try {
          await env.DB.prepare("UPDATE admin_drafts SET status = 'ready_for_review', github_pr_url = ?, github_pr_number = ?, updated_at = ? WHERE id = ?")
            .bind(publication.pull_request_url, publication.pull_request_number, now, draft.id).run();
        } catch {
          return json({ ...publication, id: draft.id, warning: "The PR exists, but its link could not be saved to the draft record." }, 201, cors);
        }
        return json({ ...publication, id: draft.id, updated_at: now, existing: false }, 201, cors);
      }
      const reviewMatch = url.pathname.match(/^\/api\/drafts\/([0-9a-f-]{36})\/review$/i);
      if (reviewMatch && request.method === "POST") {
        const now = new Date().toISOString();
        const result = await env.DB.prepare("UPDATE admin_drafts SET status = 'ready_for_review', updated_at = ? WHERE id = ? AND status = 'draft'").bind(now, reviewMatch[1]).run();
        if (!result.meta?.changes) return json({ error: "Draft not found or already submitted." }, 409, cors);
        return json({ id: reviewMatch[1], status: "ready_for_review", updated_at: now }, 200, cors);
      }
      if (url.pathname === "/api/media" && request.method === "POST") {
        if (!env.MEDIA) return json({ error: "Image upload is not enabled yet. Enable Cloudflare R2 and bind the private Admin media bucket first." }, 503, cors);
        const type = (request.headers.get("x-image-content-type") || request.headers.get("content-type") || "").toLowerCase();
        if (!IMAGE_TYPES.has(type)) return json({ error: "Only JPEG, PNG, WebP, GIF and AVIF images are supported." }, 415, cors);
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > MAX_IMAGE_BYTES) return json({ error: "Image must be 5 MB or smaller." }, 413, cors);
        if (!request.body) return json({ error: "Image data is required." }, 400, cors);
        try {
          const reader = request.body.getReader();
          const chunks = [];
          let size = 0;
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_IMAGE_BYTES) {
              await reader.cancel();
              return json({ error: "Image must be 5 MB or smaller." }, 413, cors);
            }
            chunks.push(part.value);
          }
          if (!size) return json({ error: "Image data is empty." }, 400, cors);
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const ext = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif", "image/avif":"avif" })[type];
          const key = "posts/" + crypto.randomUUID() + "." + ext;
          await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploadedBy: env.ADMIN_EMAIL } });
          if (typeof env.MEDIA_PUBLIC_BASE !== "string" || !env.MEDIA_PUBLIC_BASE.startsWith("https://")) return json({ error: "Upload stored, but a dedicated public media hostname is not configured. Do not publish this image until that is configured.", key }, 503, cors);
          return json({ key, url: env.MEDIA_PUBLIC_BASE.replace(/\/$/, "") + "/" + key, size: bytes.byteLength, content_type: type }, 201, cors);
        } catch { return safeError(); }
      }
      return json({ error: "Not found." }, 404, cors);
    } catch {
      return safeError();
    }
  },
};
