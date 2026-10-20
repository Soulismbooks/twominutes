# Admin Portal Deployment Status

Last checked: 2026-10-20 (UTC)

## Live Cloudflare resources

- Access app: `admin`, ID `58d2dad9-7bb0-4db5-973f-5908ed8fa553`
- Protected hostname: `admin.twominutes.in`
- Access audience: `b477d1d4c8df6611c28250037e0c3bf2516c717b474a4d6c509e82fdccbeb3e2`
- Access team domain: `nameless-band-cb69.cloudflareaccess.com`
- Access login method: Cloudflare identity provider. It is configured to restrict sign-in to Cloudflare account members. Account API confirms `shashank77a@gmail.com` is an accepted member.
- Policy readback: one `Allow` policy named `Only Shashank Admin`, with exactly one Include email value: `shashank77a@gmail.com`; no Exclude or Require rules.
- Worker `twominutes-admin-api`: deployed, D1 binding `DB` points to `twominutes_admin_drafts`, runtime values read back from Worker settings.
- Worker `twominutes-admin-ui`: deployed with the UI assets in a static asset map, strict response headers and same-origin API calls.
- Both Admin Workers have `workers.dev` disabled and preview URLs disabled.
- Routes read back:
  - `admin.twominutes.in/api/*` -> `twominutes-admin-api`
  - `admin.twominutes.in/*` -> `twominutes-admin-ui`
- DNS readback:
  - `admin.twominutes.in` AAAA `100::`, proxied, automatic TTL.
- D1 schema readback confirms `admin_drafts`, `idx_admin_drafts_slug_unique`, and `idx_admin_drafts_updated_at`. Draft row count last checked: 0.

## Repository and validation

- Source branch: `admin-auth-draft-save-foundation`
- PR: https://github.com/Soulismbooks/twominutes/pull/8
- Latest verified validation run for the updated editor branch: https://github.com/Soulismbooks/twominutes/actions/runs/39442241921 (all steps passed).
- PR is deliberately still Draft and unmerged pending a real browser login and first draft create/edit/reload test.
- Admin UI source files are `admin-ui/public/index.html`, `admin-ui/public/styles.css`, and `admin-ui/public/app.js`. `admin-ui/src/index.js` contains the generated asset map used for the deployed script; regenerate/synchronize it and run CI after changing UI assets.

## Safety

- Public Worker `twominutes` is unchanged.
- Root `twominutes.in` and `www.twominutes.in` DNS records were not modified by the Admin Portal work.
- No public Worker or preview URL is enabled for either Admin Worker.
- Publishing remains disabled. Analytics is not connected and must not display made-up metrics.

## Additional Admin editor features in this PR (not deployed yet)

- Block editor with heading, paragraph, bold, list and quote actions.
- Inline article image and featured image selection from device; images are resized to JPEG data URLs and embedded in the draft, rather than sent to a public upload endpoint. API validates the encoding and size. This is a small-draft convenience, not a durable media library; R2 is not enabled on the account.
- SEO title (70 chars), meta description (160 chars), category, tags and featured-image alt text.
- Review-request state (`ready_for_review`) requires a saved draft and confirmation. It does not publish a post or change the public site.
- Migration `migrations/0002_admin_editor_metadata.sql` adds metadata columns. Apply it only to the dedicated Admin D1 after review and approval; never to a public-site database.
- API and UI source plus embedded UI Worker assets must stay synchronized; CI checks this relationship.
- Actual public publishing, GitHub PR-creation runtime credentials, permanent media storage and live analytics remain future integration work. The review action is not publishing.
- The custom hostname is routed behind Cloudflare Access. The Admin API independently verifies the signed Access JWT and exact admin email.
- If the browser test fails, first use Cloudflare Access/Worker logs and read-only checks; do not remove Access policy or open a bypass as a workaround.

## Final manual acceptance test still required

1. Open `https://admin.twominutes.in` in Chrome and complete Cloudflare login with `shashank77a@gmail.com`.
2. Confirm Dashboard loads without an authentication/API error.
3. Create a test draft with a unique slug such as `admin-smoke-test-20261020`, save it, reload, open it, and confirm its content persists.
4. Confirm an unauthorized identity is denied before considering release ready.
5. After acceptance, decide whether to mark PR #8 ready and merge it. Do not merge automatically.
