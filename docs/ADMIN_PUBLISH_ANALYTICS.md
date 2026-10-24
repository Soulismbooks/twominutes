# Admin Portal: Publish (GitHub PR) and Analytics

## Publish
`POST /api/drafts/:id/publish` opens a Pull Request on `GITHUB_REPO` (default `Soulismbooks/twominutes`):

- `posts/<slug>.json` with the article, SEO fields, category/tags and `published` date
- `static/img/<uuid>.<ext>` for every private R2 image used in the body or as the featured image
- Private `/api/images/drafts/<draft>/<file>` links are rewritten to public `/img/<file>`.

Nothing goes live until the PR is merged. Merging triggers `rebuild-static-site.yml`, which runs `build.py`
(reads `posts/*.json` and copies `static/img/` to `public/img/`) and deploys the `twominutes` Worker.
The draft is then marked `ready_for_review`. Editing a draft after its PR is merged does not update the live post.

## Analytics
`GET /api/analytics?days=7|30` reads Cloudflare zone analytics (GraphQL): daily page views, daily unique visitors,
requests, and top pages for the last 24 hours. Figures include some bot traffic.

## Configuration (Admin API Worker)
| Name | Kind | Value |
|---|---|---|
| `IMAGES` | R2 binding | `twominutes-admin-images` (already in wrangler.jsonc) |
| `GITHUB_TOKEN` | Secret | fine-grained token, only this repo: Contents RW, Pull requests RW |
| `CF_API_TOKEN` | Secret | token with Zone > Analytics > Read for twominutes.in |
| `CF_ZONE_ID` | Text | Zone ID of twominutes.in |
| `GITHUB_REPO` | Text, optional | `owner/repo`, default `Soulismbooks/twominutes` |

Both `wrangler.jsonc` files set `keep_vars: true`, so a wrangler deploy keeps variables added in the dashboard.
`GET /api/health` reports `publish_ready` and `analytics_ready`.
