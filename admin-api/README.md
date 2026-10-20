# twominutes.in Admin API

Dedicated Admin API for the protected Admin Portal. It is separate from the public `twominutes` website Worker.

## Safety and deployment boundaries

- Keep `workers_dev: false` and no Preview URL.
- Keep the existing Cloudflare Access application and allow-only policy; the API independently validates the signed Access JWT and exact admin email.
- Do not reuse the public website Worker and do not put the public website behind Access.
- Draft HTML is stored as data and is only rendered in the browser's sandboxed preview. The API does not publish it.
- Public publishing is disabled until the GitHub PR-based publisher, limited runtime credential, article validation and approval flow are implemented and tested.
- Do not deploy or apply migrations to the live Admin D1 until acceptance tests and explicit approval.

## D1 schema compatibility

The D1 binding points only to the dedicated `twominutes_admin_drafts` database.

- `../migrations/0001_admin_drafts.sql`: core draft fields.
- `../migrations/0002_admin_editor_metadata.sql`: SEO title/description, category, tags and featured-image metadata.

The API checks `PRAGMA table_info(admin_drafts)` and reports the actual schema. If migration 0002 is absent, the draft list remains available with fallback metadata fields, and API responses identify `capabilities.metadata: false`. Create/edit endpoints return an actionable error for metadata writes until a schema-compatible write path is enabled. Do not claim metadata is saved just because controls are visible.

## Image storage

R2 is not enabled in the Cloudflare account. The current editor can resize images into small JPEG data URLs embedded in a Draft, but that is not durable media storage and is not a permanent public image URL. Do not deploy a public upload endpoint or call this a complete media library. R2 must first be enabled in the Cloudflare Dashboard, then a private authenticated upload path and tests must be added.

## Real Cloudflare traffic analytics

The Analytics page queries the Cloudflare GraphQL Analytics API for actual HTTP request traffic filtered to the canonical public hostname `www.twominutes.in` and end-user traffic (`requestSource: eyeball`). It shows requests, Cloudflare-defined visits, response bytes, a day-by-day trend and top request paths. Requests are not page views, and visits are not unique visitors; UI labels must retain this distinction. Errors/unconfigured state must never fall back to demo data.

The public Zone ID and canonical hostname are non-secret values in `wrangler.jsonc`. Set the following Worker secret through the Cloudflare Dashboard or Wrangler secret manager; never store it in this file or source control:

```text
CLOUDFLARE_ANALYTICS_TOKEN
```

Create a Cloudflare API token with only **Analytics Read** access for the `twominutes.in` zone. The Analytics UI stays unavailable until this secret exists and the GraphQL request is successful. The secret has not been set by these source-only changes.

## Authentication

The API requires `Cf-Access-Jwt-Assertion`, verifies the RS256 signature against Cloudflare Access public keys, checks issuer/audience/expiry and compares the signed email with `ADMIN_EMAIL`. Client-provided email headers are not used for authorization. Write requests also require the exact configured `Origin`.

## Routes

- `GET /api/health`: API and D1 schema health/capabilities.
- `GET /api/drafts`
- `POST /api/drafts`
- `GET /api/drafts/:uuid`
- `PUT /api/drafts/:uuid`
- `DELETE /api/drafts/:uuid`
- `PATCH /api/drafts/:uuid/review`: move draft to `ready_for_review`; this is not publishing.
- `GET /api/analytics?days=1|7|30`: actual Cloudflare GraphQL HTTP metrics, only after token setup.

All routes require a valid Access JWT and exact admin identity. The Admin API is not deployed by this PR, and no analytics secret or live migration has been set through these edits.
