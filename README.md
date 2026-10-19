# twominutes.in — static site (Blogger se migrated)

- `feed.atom` = Blogger export (source of truth)
- `build.py`  = feed se `public/` generate karta hai (`python3 build.py`)
- `public/`   = ready-to-deploy site (Cloudflare Pages isi folder ko serve karega)

## Deploy
1. GitHub pe naya repo banao, ye saari files push karo.
2. Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git > repo select.
3. Build command: (khali chhodo)   Build output directory: `public`
4. Deploy ke baad Custom domains > `www.twominutes.in` add karo (+ `twominutes.in` -> www redirect).
5. DNS (domain Cloudflare pe ho to) Blogger ka purana CNAME (ghs.google.com) hata do; Cloudflare khud naya record bana dega.
6. Google Search Console > Sitemaps > `https://www.twominutes.in/sitemap.xml`.
