/**
 * Publish (GitHub Pull Request) and Analytics (Cloudflare GraphQL) helpers for the Admin API.
 * Both functions return { status, body } and must only be called after Access JWT + origin checks.
 *
 * Needs these on the Admin API Worker:
 *   GITHUB_TOKEN  secret  fine-grained token for the repo: Contents = Read and write, Pull requests = Read and write
 *   GITHUB_REPO   text    optional, default "Soulismbooks/twominutes"
 *   CF_API_TOKEN  secret  token with Zone > Analytics > Read
 *   CF_ZONE_ID    text    Zone ID of twominutes.in
 *   IMAGES        R2 binding (already used for image upload)
 */
const IMAGE_PATH_RE = /\/api\/images\/(drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)))/gi;
const MAX_IMAGES_PER_POST = 20;

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function githubRepo(env) {
  const repo = typeof env.GITHUB_REPO === "string" && env.GITHUB_REPO.trim() ? env.GITHUB_REPO.trim() : "Soulismbooks/twominutes";
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : null;
}

function gh(env, repo, path, init = {}) {
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "twominutes-admin-api",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const fail = (status, error) => ({ status, body: { error } });

/** Pulls every private image reference out of the article and the featured image. */
function collectImages(draft) {
  const keys = new Map(); // r2 key -> public file name
  for (const text of [draft.body_html || "", draft.featured_image || ""]) {
    for (const m of text.matchAll(IMAGE_PATH_RE)) keys.set(m[1], m[2]);
  }
  return keys;
}

function toPublicImagePaths(text) {
  return (text || "").replace(IMAGE_PATH_RE, "/img/$2");
}

export async function publishDraft(draft, env) {
  if (typeof env.GITHUB_TOKEN !== "string" || !env.GITHUB_TOKEN) return fail(503, "Publish के लिए GITHUB_TOKEN secret जोड़ना बाकी है।");
  const repo = githubRepo(env);
  if (!repo) return fail(503, "GITHUB_REPO का मान सही नहीं है।");
  if (!draft.body_html || !draft.body_html.replace(/<[^>]*>/g, "").trim()) return fail(400, "लेख की सामग्री खाली है।");
  if (!/^[a-z0-9ऀ-ॿ-]+$/.test(draft.slug || "")) return fail(400, "Slug सही नहीं है।");

  const files = []; // { name, bytes }
  const imageKeys = collectImages(draft);
  if (imageKeys.size > MAX_IMAGES_PER_POST) return fail(400, `एक लेख में ज़्यादा से ज़्यादा ${MAX_IMAGES_PER_POST} images।`);
  if (imageKeys.size && !env.IMAGES) return fail(503, "Image storage जुड़ा नहीं है।");
  for (const [key, name] of imageKeys) {
    const object = await env.IMAGES.get(key);
    if (!object) return fail(400, "लेख की एक image R2 में नहीं मिली। उसे दोबारा जोड़ें।");
    files.push({ name, bytes: new Uint8Array(await object.arrayBuffer()) });
  }

  // Older drafts may carry the featured image as a small inline JPEG.
  let featured = toPublicImagePaths(draft.featured_image);
  const inline = featured.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (inline) {
    const raw = atob(inline[1]);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const name = `${crypto.randomUUID()}.jpg`;
    files.push({ name, bytes });
    featured = `/img/${name}`;
  }

  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  const labels = [...new Set([draft.category, ...tags].filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))].slice(0, 8);
  const postPath = `posts/${draft.slug}.json`;

  const exists = await gh(env, repo, `/contents/${encodePath(postPath)}?ref=main`);
  if (exists.status === 200) return fail(409, "इस slug का लेख रिपॉज़ में पहले से मौजूद है। Slug बदलें।");
  if (exists.status !== 404) return fail(502, "GitHub से जुड़ नहीं पाए। Token और repo की अनुमति जाँचें।");

  const refRes = await gh(env, repo, "/git/ref/heads/main");
  if (!refRes.ok) return fail(502, "GitHub की main branch नहीं मिली।");
  const baseSha = (await refRes.json())?.object?.sha;
  if (!baseSha) return fail(502, "GitHub की main branch नहीं मिली।");

  const branch = `admin/post-${draft.id.slice(0, 8)}-${Date.now().toString(36)}`;
  const mk = await gh(env, repo, "/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
  if (!mk.ok) return fail(502, "GitHub में branch नहीं बन सकी।");

  const put = async (path, bytes, message) => {
    const res = await gh(env, repo, `/contents/${encodePath(path)}`, { method: "PUT", body: JSON.stringify({ message, content: bytesToB64(bytes), branch }) });
    if (!res.ok) throw new Error(`put failed: ${path}`);
  };

  const record = {
    title: draft.title,
    slug: draft.slug,
    summary: draft.summary || "",
    body_html: toPublicImagePaths(draft.body_html),
    seo_title: draft.seo_title || "",
    seo_description: draft.seo_description || "",
    category: draft.category || "",
    tags,
    labels,
    featured_image: featured,
    featured_image_alt: draft.featured_image_alt || "",
    published: new Date().toISOString().slice(0, 10),
  };

  try {
    for (const file of files) await put(`static/img/${file.name}`, file.bytes, `Add image for "${draft.title}"`);
    await put(postPath, new TextEncoder().encode(JSON.stringify(record, null, 2) + "\n"), `Add post: ${draft.title}`);
    const pr = await gh(env, repo, "/pulls", {
      method: "POST",
      body: JSON.stringify({
        title: `नया लेख: ${draft.title}`,
        head: branch,
        base: "main",
        body: `Admin Portal से भेजा गया लेख।\n\n- Slug: \`${draft.slug}\`\n- Images: ${files.length}\n- Labels: ${labels.join(", ") || "—"}\n\nMerge करते ही साइट दोबारा बनेगी और लेख लाइव हो जाएगा।`,
      }),
    });
    if (!pr.ok) throw new Error("pr failed");
    const prData = await pr.json();
    return { status: 201, body: { ok: true, pr_url: prData.html_url, pr_number: prData.number, status: "ready_for_review", images: files.length } };
  } catch {
    // Best-effort cleanup so a failed attempt does not leave an orphan branch.
    try { await gh(env, repo, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }); } catch { /* ignore */ }
    return fail(502, "GitHub पर लेख भेजते समय त्रुटि हुई। फिर प्रयास करें।");
  }
}

async function cfGraphql(env, query, variables) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`graphql http ${res.status}`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message || "graphql error");
  return data.data;
}

export async function getAnalytics(url, env) {
  if (typeof env.CF_API_TOKEN !== "string" || !env.CF_API_TOKEN || typeof env.CF_ZONE_ID !== "string" || !env.CF_ZONE_ID) {
    return { status: 503, body: { error: "Analytics के लिए CF_API_TOKEN और CF_ZONE_ID जोड़ना बाकी है।", configured: false } };
  }
  const days = url.searchParams.get("days") === "30" ? 30 : 7;
  const day = (d) => d.toISOString().slice(0, 10);
  const since = new Date(Date.now() - (days - 1) * 86400000);

  const dailyQuery = `query($zone:String!,$since:Date!,$until:Date!){viewer{zones(filter:{zoneTag:$zone}){
    httpRequests1dGroups(limit:60,filter:{date_geq:$since,date_leq:$until},orderBy:[date_ASC]){
      dimensions{date} sum{pageViews requests} uniq{uniques}}}}}`;
  const pagesQuery = `query($zone:String!,$since:Time!,$until:Time!){viewer{zones(filter:{zoneTag:$zone}){
    httpRequestsAdaptiveGroups(limit:60,filter:{datetime_geq:$since,datetime_leq:$until,requestSource:"eyeball",edgeResponseStatus:200},orderBy:[count_DESC]){
      count dimensions{clientRequestPath}}}}}`;

  let daily;
  try {
    const data = await cfGraphql(env, dailyQuery, { zone: env.CF_ZONE_ID, since: day(since), until: day(new Date()) });
    daily = (data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? []).map((g) => ({
      date: g.dimensions.date, page_views: g.sum.pageViews, requests: g.sum.requests, visitors: g.uniq.uniques,
    }));
  } catch {
    return fail(502, "Cloudflare से analytics नहीं मिला। Token की अनुमति (Zone Analytics Read) और Zone ID जाँचें।");
  }

  // Cloudflare keeps request-level data only for a short window, so top pages cover the last 24 hours.
  let top_pages = null;
  try {
    const data = await cfGraphql(env, pagesQuery, {
      zone: env.CF_ZONE_ID, since: new Date(Date.now() - 86400000).toISOString(), until: new Date().toISOString(),
    });
    top_pages = (data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [])
      .map((r) => ({ path: r.dimensions.clientRequestPath, views: r.count }))
      .filter((r) => r.path && (r.path === "/" || !/\.[a-z0-9]{2,5}$/i.test(r.path) || r.path.endsWith(".html")))
      .slice(0, 10);
  } catch { top_pages = null; }

  const total = (k) => daily.reduce((s, d) => s + (d[k] || 0), 0);
  return {
    status: 200,
    body: {
      configured: true, days,
      totals: { page_views: total("page_views"), visitors_sum: total("visitors"), requests: total("requests") },
      daily, top_pages,
      note: "Visitors रोज़ के unique आगंतुक हैं; अलग-अलग दिनों को जोड़ने पर वही व्यक्ति दोबारा गिना जा सकता है। इसमें कुछ bot ट्रैफ़िक भी शामिल हो सकता है।",
    },
  };
}

export { collectImages, toPublicImagePaths };
