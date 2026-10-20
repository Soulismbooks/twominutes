# twominutes.in Admin API (staging-only source)

This is the dedicated draft API implementation. It is separate from the public
`twominutes` website Worker.

## Safety gates

- Wrangler config sets `workers_dev: false` and defines no routes. Do not turn
  on `workers_dev` or add a custom route until a dedicated Cloudflare Access
  application and its allow-only policy have been created and tested.
- Required runtime variables: `ADMIN_EMAIL`, `ACCESS_TEAM_DOMAIN`,
  `ACCESS_AUD`, and `ADMIN_ORIGIN`. They are intentionally not hard-coded in
  this config. Set them only after Access is configured.
- `ADMIN_EMAIL` must be exactly `shashank77a@gmail.com`.
- Keep this API isolated from the public website Worker. Do not reuse the
  public Worker or make the entire website Access-protected.
- Browser HTML/code is not executed by this API. `body_html` is stored as
  draft data only; sanitize before any future public publication.
- This implementation supports draft CRUD only. It does not publish articles,
  edit `feed.atom`, or deploy the public site.

## Database

The D1 binding points to the dedicated `twominutes_admin_drafts` database.
Schema source: `../migrations/0001_admin_drafts.sql`.

## Authentication

The API requires `Cf-Access-Jwt-Assertion`, validates its RS256 signature
against Cloudflare Access public keys, checks issuer, audience and expiry, then
compares the signed `email` claim against `ADMIN_EMAIL`. Client-supplied
email headers are never used for authorization.

## API (after Access setup)

- `GET /api/health`
- `GET /api/drafts`
- `POST /api/drafts`
- `GET /api/drafts/:uuid`
- `PUT /api/drafts/:uuid`

All routes require a valid Access JWT and the exact admin identity. Writes also
require the exact `Origin` in `ADMIN_ORIGIN`. Set up Cloudflare Access before
routing traffic to this API. Run security and integration tests in staging
before connecting a hostname.
