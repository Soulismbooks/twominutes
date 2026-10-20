import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  normalizeTeamDomain, safeSlug, parseDraft, hasValidClaims, verifyAccessJwt, readJsonBody, originAllowed,
} from "../admin-api/src/index.js";

const DOMAIN = "nameless-band-cb69.cloudflareaccess.com";
const AUD = "test-access-audience";
const ADMIN = "shashank77a@gmail.com";
const NOW = Math.floor(Date.now() / 1000);
const encoder = new TextEncoder();
const b64 = (value) => Buffer.from(value).toString("base64url");

async function makeJwt({ email = ADMIN, exp = NOW + 300, nbf, iss = `https://${DOMAIN}`, aud = [AUD], alg = "RS256", keyPair }) {
  const pair = keyPair || await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "unit-test-kid";
  const header = b64(JSON.stringify({ alg, typ: "JWT", kid: jwk.kid }));
  const payload = b64(JSON.stringify({ iss, aud, exp, nbf, iat: NOW, email }));
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, encoder.encode(`${header}.${payload}`));
  return { token: `${header}.${payload}.${Buffer.from(sig).toString("base64url")}`, jwk, pair };
}

test("normalize team domain safely", () => {
  assert.equal(normalizeTeamDomain(`https://${DOMAIN}/`), DOMAIN);
  assert.equal(normalizeTeamDomain("evil.example"), null);
  assert.equal(normalizeTeamDomain(""), null);
});

test("claims reject expired token, wrong iss/aud and future nbf", () => {
  const base = { iss: `https://${DOMAIN}`, aud: [AUD], exp: NOW + 90 };
  assert.equal(hasValidClaims(base, DOMAIN, AUD, NOW), true);
  assert.equal(hasValidClaims({ ...base, exp: NOW }, DOMAIN, AUD, NOW), false);
  assert.equal(hasValidClaims({ ...base, iss: "https://wrong.cloudflareaccess.com" }, DOMAIN, AUD, NOW), false);
  assert.equal(hasValidClaims({ ...base, aud: ["wrong"] }, DOMAIN, AUD, NOW), false);
  assert.equal(hasValidClaims({ ...base, nbf: NOW + 1 }, DOMAIN, AUD, NOW), false);
});

test("JWT requires RS256, valid signature, issuer, audience, exp, nbf and matching kid", async () => {
  const signed = await makeJwt({});
  const env = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD };
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), {
    status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=60" },
  });
  assert.equal((await verifyAccessJwt(signed.token, env))?.email, ADMIN);
  const expired = await makeJwt({ exp: NOW - 10, keyPair: signed.pair });
  assert.equal(await verifyAccessJwt(expired.token, env), null);
  const wrongIssuer = await makeJwt({ iss: "https://wrong.cloudflareaccess.com", keyPair: signed.pair });
  assert.equal(await verifyAccessJwt(wrongIssuer.token, env), null);
  const wrongAudience = await makeJwt({ aud: ["wrong"], keyPair: signed.pair });
  assert.equal(await verifyAccessJwt(wrongAudience.token, env), null);
  const futureNbf = await makeJwt({ nbf: NOW + 100, keyPair: signed.pair });
  assert.equal(await verifyAccessJwt(futureNbf.token, env), null);
  assert.equal(await verifyAccessJwt(signed.token.slice(0, -3) + "abc", env), null);
  const wrongKidParts = signed.token.split(".");
  wrongKidParts[0] = b64(JSON.stringify({ alg: "RS256", kid: "missing-kid" }));
  const msg = encoder.encode(`${wrongKidParts[0]}.${wrongKidParts[1]}`);
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", signed.pair.privateKey, msg);
  wrongKidParts[2] = Buffer.from(sig).toString("base64url");
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  assert.equal(await verifyAccessJwt(wrongKidParts.join("."), env), null);
});

test("invalid signing algorithm is rejected", async () => {
  const signed = await makeJwt({ alg: "HS256" });
  assert.equal(await verifyAccessJwt(signed.token, { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD }), null);
});

test("missing Access configuration fails closed", async () => {
  assert.equal(await verifyAccessJwt("a.b.c", {}), null);
});

test("exact admin email policy is enforced by route", async () => {
  const signed = await makeJwt({ email: "someone-else@gmail.com" });
  const env = {
    ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD, ADMIN_EMAIL: ADMIN,
    ADMIN_ORIGIN: "https://admin.example.com",
    DB: { prepare() { throw new Error("DB must not be used on denied identity"); } },
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const { default: worker } = await import("../admin-api/src/index.js");
  const response = await worker.fetch(new Request("https://api.example.com/api/drafts", {
    headers: { "Cf-Access-Jwt-Assertion": signed.token },
  }), env);
  assert.equal(response.status, 403);
});

test("body size cap works even without Content-Length", async () => {
  const oversized = "x".repeat(1_000_001);
  const result = await readJsonBody(new Request("https://local.test/api/drafts", {
    method: "POST", body: oversized,
  }));
  assert.match(result.error, /too large/i);
});

test("slug validation and duplicate slug constraint are enforced in isolated SQLite", async () => {
  assert.equal(safeSlug(" Hello, World! "), "hello-world");
  assert.equal(safeSlug("../../../"), "");
  const parsed = parseDraft({ title: "Test", slug: "Example Slug", summary: "", body_html: "" });
  assert.equal(parsed.data.slug, "example-slug");
  assert.ok(parseDraft({ title: "", slug: "x", body_html: "" }).error);

  // Mirror the migration in an isolated in-memory SQLite DB, not Cloudflare production D1.
  const { spawnSync } = await import("node:child_process").then(async () => await import("node:child_process"));
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const sql = readFileSync(resolve("migrations/0001_admin_drafts.sql"), "utf8");
  const py = [
    "import sqlite3,sys",
    "db=sqlite3.connect(':memory:')",
    "db.executescript(sys.stdin.read())",
    "db.execute(\"INSERT INTO admin_drafts VALUES (?,?,?,?,?,?,?,?)\", ('1','A','same-slug','','<script>data only</script>','draft','t','t'))",
    "try:",
    " db.execute(\"INSERT INTO admin_drafts VALUES (?,?,?,?,?,?,?,?)\", ('2','B','same-slug','','','draft','t','t'))",
    " raise SystemExit('duplicate slug accepted')",
    "except sqlite3.IntegrityError: pass",
    "try:",
    " db.execute(\"INSERT INTO admin_drafts VALUES (?,?,?,?,?,?,?,?)\", ('3','Bad','bad','','','published','t','t'))",
    " raise SystemExit('invalid status accepted')",
    "except sqlite3.IntegrityError: pass",
    "body=db.execute('SELECT body_html FROM admin_drafts WHERE id=1').fetchone()[0]",
    "assert body == '<script>data only</script>'",
    "print('isolated D1 schema checks passed')",
  ].join("\n");
  const result = spawnSync("python", ["-c", py], { input: sql, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("origin check requires exact configured HTTPS origin", () => {
  const env = { ADMIN_ORIGIN: "https://admin.example.com" };
  assert.equal(originAllowed(new Request("https://api.example.com", { headers: { Origin: env.ADMIN_ORIGIN } }), env), true);
  assert.equal(originAllowed(new Request("https://api.example.com", { headers: { Origin: "https://evil.example.com" } }), env), false);
  assert.equal(originAllowed(new Request("https://api.example.com"), env), false);
});
