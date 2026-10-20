# twominutes.in Admin UI

Separate static UI Worker for the Admin Portal. Its deployable source embeds the three UI files in a generated asset map. It is intentionally isolated
from the public `twominutes` Worker.

## Safety status

- `workers_dev: false`; no routes or custom domains are declared.
- `src/index.js` is generated from `public/index.html`, `public/styles.css`, and `public/app.js`; regenerate/sync it after UI asset changes and run CI before deploying.
- Do not attach a route or domain until a dedicated Cloudflare Access
  self-hosted application is verified and protects the Admin hostname.
- After UI/API are staged and tested, the intended route plan is:
  - `admin.twominutes.in/*` -> this UI Worker
  - `admin.twominutes.in/api/*` -> separate `twominutes-admin-api` Worker
  Both routes must remain behind the same exact-email Access application.
- Do not alter root or `www` DNS, the public Worker, or public deployment workflow.

## Functionality

- Loads the draft list from the same-origin `/api/drafts` endpoint.
- Create and edit drafts; autosave via the API after title and slug are filled.
- Explicit save is always available.
- Preview executes user content only in an iframe with `sandbox="allow-scripts"`
  and a restrictive CSP, without `allow-same-origin`.
- Analytics are honestly marked unavailable until a real provider is connected.
- Publishing is not enabled until a reviewed GitHub PR-based publishing workflow
  and validation/approval gates exist.

## Required API behavior

The UI expects `GET /api/drafts`, `POST /api/drafts`,
`GET /api/drafts/:uuid`, and `PUT /api/drafts/:uuid` from the separate API
Worker on this same hostname. The API must continue to validate the signed
Cloudflare Access JWT and exact admin email on every request.

## Recovery / disable

If the Admin Portal has a problem, remove/disable only the Admin UI and API
routes or disable their Workers after checking Access policy state. Do not
modify the public `twominutes` Worker or its root/`www` DNS records. Since
drafts are in the dedicated D1 database, disabling the UI/API does not remove
saved drafts. Before deleting either Worker or the D1 database, export and
verify drafts. Keep the Access policy in place while investigating; do not
temporarily allow everyone as a workaround.
