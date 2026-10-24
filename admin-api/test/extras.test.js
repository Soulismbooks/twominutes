import test from "node:test";
import assert from "node:assert/strict";
import { publishDraft, getAnalytics, collectImages, toPublicImagePaths } from "../src/extras.js";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const IMG1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMG2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function makeEnv(extra = {}) {
  const r2 = new Map([[`drafts/${DRAFT}/${IMG1}.jpg`, PNG], [`drafts/${DRAFT}/${IMG2}.png`, PNG]]);
  return {
    IMAGES: { async get(k) { const b = r2.get(k); return b && { async arrayBuffer() { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } }; } },
    GITHUB_TOKEN: "GHTOKEN", CF_API_TOKEN: "CF", CF_ZONE_ID: "Z", ...extra,
  };
}
function draft(over = {}) {
  return {
    id: DRAFT, title: "मेरा लेख", slug: "mera-lekh", summary: "सार", category: "Money Tips", tags: ["बचत", "निवेश"],
    seo_title: "SEO", seo_description: "desc", featured_image: `/api/images/drafts/${DRAFT}/${IMG2}.png`, featured_image_alt: "alt",
    body_html: `<p>hi</p><figure><img src="/api/images/drafts/${DRAFT}/${IMG1}.jpg"></figure>`, ...over,
  };
}
function mockGithub({ existing = false, failPut = false } = {}) {
  const log = { puts: [], refs: [], pulls: [], deleted: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), m = init.method || "GET";
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    if (!url.startsWith("https://api.github.com/repos/Soulismbooks/twominutes")) throw new Error("unexpected fetch " + url);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer GHTOKEN");
    const path = url.replace("https://api.github.com/repos/Soulismbooks/twominutes", "");
    if (path.startsWith("/contents/posts/") && m === "GET") return J({}, existing ? 200 : 404);
    if (path === "/git/ref/heads/main") return J({ object: { sha: "BASE" } });
    if (path === "/git/refs" && m === "POST") { log.refs.push(JSON.parse(init.body)); return J({}, 201); }
    if (path.startsWith("/contents/") && m === "PUT") { if (failPut) return J({}, 500); log.puts.push({ path: decodeURIComponent(path.slice(10)), ...JSON.parse(init.body) }); return J({}, 201); }
    if (path === "/pulls" && m === "POST") { log.pulls.push(JSON.parse(init.body)); return J({ html_url: "https://github.com/Soulismbooks/twominutes/pull/42", number: 42 }, 201); }
    if (path.startsWith("/git/refs/heads/") && m === "DELETE") { log.deleted.push(path); return new Response(null, { status: 204 }); }
    throw new Error("unexpected " + m + " " + path);
  };
  return log;
}

test("collectImages finds private image paths in body and featured image only", () => {
  const keys = collectImages(draft());
  assert.deepEqual([...keys.values()].sort(), [`${IMG1}.jpg`, `${IMG2}.png`]);
  assert.equal(collectImages({ body_html: '<img src="/api/images/../../secret.png"><img src="https://evil/api/images/x.png">' }).size, 0);
  assert.equal(toPublicImagePaths(`<img src="/api/images/drafts/${DRAFT}/${IMG1}.jpg">`), `<img src="/img/${IMG1}.jpg">`);
});

test("publish opens a PR with the post, its images and metadata", async () => {
  const log = mockGithub();
  const out = await publishDraft(draft(), makeEnv());
  assert.equal(out.status, 201, JSON.stringify(out.body));
  assert.equal(out.body.pr_url, "https://github.com/Soulismbooks/twominutes/pull/42");
  const paths = log.puts.map((p) => p.path);
  assert.deepEqual(paths.slice(0, 2).sort(), [`static/img/${IMG1}.jpg`, `static/img/${IMG2}.png`]);
  assert.equal(paths[2], "posts/mera-lekh.json");
  assert.ok(log.puts.every((p) => p.branch === log.refs[0].ref.replace("refs/heads/", "")));
  const rec = JSON.parse(Buffer.from(log.puts[2].content, "base64").toString("utf8"));
  assert.ok(rec.body_html.includes(`/img/${IMG1}.jpg`) && !rec.body_html.includes("/api/images/"));
  assert.equal(rec.featured_image, `/img/${IMG2}.png`);
  assert.deepEqual(rec.labels, ["Money Tips", "बचत", "निवेश"]);
  assert.equal(rec.seo_title, "SEO");
  assert.match(rec.published, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(log.pulls[0].base, "main");
});

test("publish refuses missing token, empty body, bad slug and duplicate slug", async () => {
  mockGithub();
  assert.equal((await publishDraft(draft(), makeEnv({ GITHUB_TOKEN: undefined }))).status, 503);
  assert.equal((await publishDraft(draft({ body_html: "<p><br></p>" }), makeEnv())).status, 400);
  assert.equal((await publishDraft(draft({ slug: "bad slug/../x" }), makeEnv())).status, 400);
  const log = mockGithub({ existing: true });
  assert.equal((await publishDraft(draft(), makeEnv())).status, 409);
  assert.equal(log.refs.length, 0);
});

test("a failed upload deletes the half-made branch", async () => {
  const log = mockGithub({ failPut: true });
  const out = await publishDraft(draft(), makeEnv());
  assert.equal(out.status, 502);
  assert.equal(log.deleted.length, 1);
  assert.equal(log.pulls.length, 0);
});

test("analytics needs configuration, returns totals and filters asset paths", async () => {
  assert.equal((await getAnalytics(new URL("https://x/api/analytics"), { })).status, 503);
  globalThis.fetch = async (_url, init) => {
    const q = JSON.parse(init.body).query;
    const body = q.includes("httpRequests1dGroups")
      ? { data: { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: "2026-10-22" }, sum: { pageViews: 10, requests: 50 }, uniq: { uniques: 4 } }] }] } } }
      : { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: 9, dimensions: { clientRequestPath: "/" } }, { count: 8, dimensions: { clientRequestPath: "/img/a.jpg" } }, { count: 7, dimensions: { clientRequestPath: "/2026/10/a.html" } }] }] } } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const out = await getAnalytics(new URL("https://x/api/analytics?days=30"), makeEnv());
  assert.equal(out.status, 200);
  assert.equal(out.body.days, 30);
  assert.equal(out.body.totals.page_views, 10);
  assert.deepEqual(out.body.top_pages.map((p) => p.path), ["/", "/2026/10/a.html"]);
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  assert.equal((await getAnalytics(new URL("https://x/api/analytics"), makeEnv())).status, 502);
});
