# Admin Portal — Recovery and Safe Disable Guide

## Isolation
The Admin Portal uses the dedicated Workers `twominutes-admin-ui` and
`twominutes-admin-api`, plus D1 database `twominutes_admin_drafts`.
The public website uses a separate Worker, `twominutes`, and its
`feed.atom -> build.py -> public/` pipeline.

## If Admin Portal is unavailable
1. Check Cloudflare status and read-only Worker/Access application state.
2. Check the Admin UI/API Worker logs for generic error codes; never print JWTs,
   request bodies, secrets or raw tokens in logs.
3. Check Access app/policy first. Restore only the intended single-email policy.
4. Check the D1 schema and row counts before changing or rerunning any migration.
5. Roll back the most recent Admin UI/API code change through its reviewed GitHub
   PR/deployment revision; do not alter the public Worker.

## Safe disable
- Disable only the Admin UI/API custom routes, or stop the dedicated Admin UI
  and API Workers.
- Keep Access protection on any remaining admin route.
- Do not create an open fallback route.
- Leave the D1 database intact so drafts remain recoverable.
- Do not change root or www DNS or public Worker `twominutes`.

## Before re-enabling
- Confirm the Access app domain and policy by reading the full resource back.
- Verify the exact Allow email is `shashank77a@gmail.com` and no bypass or
  wildcard allow policy exists.
- Test unauthenticated and wrong-email denial.
- Test draft create/read/update in an isolated staging route.
- Enable UI/API routes only behind Access, then verify the public homepage and
  one existing public article URL have not changed.

## Publishing and analytics
Publishing is not a feature of the current API. Never add an unrestricted
publish endpoint. Publishing must create a reviewed GitHub branch/PR with
existing URL slugs preserved and validators passing before human approval.
Analytics must use a real connected provider; until then the UI displays
"not connected" rather than synthetic visitor metrics.
