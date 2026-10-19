#!/usr/bin/env python3
"""Blogger feed.atom -> static site in ./public (old Blogger URLs preserved)."""
import re, html, shutil, math
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

BASE = "https://www.twominutes.in"
SITE = "Two Minutes to Happiness & Wealth"
TAGLINE = "Quick 2-minute tips for a happy life & personal finance! Learn budgeting, saving, and investing at twominutes.in."
ADSENSE = "ca-pub-5852664798648088"
PER_PAGE = 10
ROOT = Path(__file__).parent
OUT = ROOT / "public"
NS = {"a": "http://www.w3.org/2005/Atom", "b": "http://schemas.google.com/blogger/2018"}

def pretty(p): return p[:-5] if p.endswith(".html") else p

def clean_title(t): return html.unescape(t or "").strip()
def esc(s): return html.escape(s, quote=True)
def slug(s):
    s = re.sub(r"[^\w\u0900-\u097F]+", "-", s.strip().lower()).strip("-")
    return s or "label"

def tidy(c):
    # Blogger/Docs paste leaves tiny inline fonts (7.2pt etc.) -> drop font-family/size
    def fix(m):
        st = re.sub(r"(font-family|font-size|line-height|white-space-collapse|font-variant[\w-]*)\s*:[^;\"]*;?", "", m.group(1))
        st = st.strip()
        return f'style="{st}"' if st else ""
    c = re.sub(r'style="([^"]*)"', fix, c)
    c = re.sub(r"<img ", '<img loading="lazy" ', c)
    return c

def text_of(c, n=160):
    t = html.unescape(re.sub(r"<[^>]+>", " ", c)); t = re.sub(r"\s+", " ", t).strip()
    return (t[:n].rsplit(" ", 1)[0] + "…") if len(t) > n else t

def first_img(c):
    m = re.search(r'<img[^>]+src="([^"]+)"', c)
    if not m: return None
    return re.sub(r"/s\d+/", "/s1200/", m.group(1))

root = ET.parse(ROOT / "feed.atom").getroot()
posts, pages = [], []
for e in root.findall("a:entry", NS):
    typ = e.findtext("b:type", namespaces=NS); status = e.findtext("b:status", namespaces=NS)
    fn = e.findtext("b:filename", namespaces=NS)
    if status != "LIVE" or typ not in ("POST", "PAGE") or not fn: continue
    c = e.findtext("a:content", namespaces=NS) or ""
    d = dict(type=typ, path=fn, title=clean_title(e.findtext("a:title", namespaces=NS)),
             pub=(e.findtext("a:published", namespaces=NS) or "")[:10],
             upd=(e.findtext("a:updated", namespaces=NS) or "")[:10],
             content=tidy(c), desc=text_of(c), img=first_img(c),
             labels=[k.get("term") for k in e.findall("a:category", NS) if k.get("term")])
    (posts if typ == "POST" else pages).append(d)
posts.sort(key=lambda p: p["pub"], reverse=True)
pages.sort(key=lambda p: p["title"])

CSS = """:root{--bg:#fff;--fg:#1d1d1f;--mut:#6b6b73;--card:#f6f6f8;--acc:#0b7a4b;--bd:#e4e4ea}
@media(prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececf0;--mut:#9a9aa5;--card:#1c1c20;--acc:#4cc38a;--bd:#2c2c33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.75 system-ui,-apple-system,"Segoe UI","Noto Sans Devanagari",Roboto,sans-serif}
a{color:var(--acc)}header.s{border-bottom:1px solid var(--bd)}.w{max-width:760px;margin:0 auto;padding:0 18px}
header.s .w{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;justify-content:space-between;padding-top:14px;padding-bottom:14px}
.logo{font-weight:700;font-size:1.1rem;text-decoration:none;color:var(--fg)}nav a{margin-right:14px;text-decoration:none;font-size:.95rem}
main{padding:26px 0 50px}h1{line-height:1.35;font-size:1.7rem}h2,h3{line-height:1.4}
.meta{color:var(--mut);font-size:.9rem}.card{display:block;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px 18px;margin:0 0 16px;text-decoration:none;color:var(--fg)}
.card h2{margin:0 0 6px;font-size:1.15rem}.card p{margin:6px 0 0;color:var(--mut);font-size:.95rem}
.post img{max-width:100%;height:auto!important}.post table{display:block;overflow-x:auto;max-width:100%}.post iframe{max-width:100%}
.tags a{display:inline-block;margin:0 6px 6px 0;padding:2px 10px;border:1px solid var(--bd);border-radius:99px;font-size:.85rem;text-decoration:none}
.pager{display:flex;justify-content:space-between;margin-top:24px}footer{border-top:1px solid var(--bd);color:var(--mut);font-size:.9rem;padding:20px 0}"""

def layout(title, desc, path, body, img=None, article=None, noindex=False):
    full = f"{title} | {SITE}" if path not in ("/",) else SITE
    url = BASE + quote(pretty(path), safe="/%")
    og = f'<meta property="og:image" content="{esc(img)}">' if img else ""
    art = ""
    if article:
        art = f'<meta property="article:published_time" content="{article["pub"]}"><meta property="article:modified_time" content="{article["upd"]}">'
    nav = "".join(f'<a href="{esc(pretty(p["path"]))}">{esc(p["title"])}</a>' for p in pages if p["path"] != "/p/2-minute-tips.html") + '<a href="/p/2-minute-tips">Contact</a>'
    return f"""<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(full)}</title><meta name="description" content="{esc(desc)}"><link rel="canonical" href="{esc(url)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{esc(url)}"><meta property="og:type" content="{'article' if article else 'website'}"><meta property="og:site_name" content="{esc(SITE)}">{og}{art}
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/atom+xml" title="{esc(SITE)}" href="/atom.xml"><link rel="icon" href="/favicon.ico">
<style>{CSS}</style>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={ADSENSE}" crossorigin="anonymous"></script>
</head><body><header class="s"><div class="w"><a class="logo" href="/">{esc(SITE)}</a><nav>{nav}</nav></div></header>
<main class="w">{body}</main><footer><div class="w">© {esc(SITE)} · <a href="/atom.xml">RSS</a></div></footer></body></html>"""

def write(path, content):
    p = OUT / path.lstrip("/")
    if path.endswith("/"): p = p / "index.html"
    p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content, encoding="utf-8")

def card(p):
    return f'<a class="card" href="{esc(pretty(p["path"]))}"><h2>{esc(p["title"])}</h2><div class="meta">{p["pub"]}</div><p>{esc(p["desc"])}</p></a>'

def listing(items, base, heading=None, title=None, desc=TAGLINE):
    n = max(1, math.ceil(len(items) / PER_PAGE))
    for i in range(n):
        chunk = items[i*PER_PAGE:(i+1)*PER_PAGE]
        path = base if i == 0 else f"{base}page/{i+1}/"
        pager = '<div class="pager"><span>' + (f'<a href="{base if i==1 else base+"page/"+str(i)+"/"}">← नए पोस्ट</a>' if i else '') + '</span><span>' + (f'<a href="{base}page/{i+2}/">पुराने पोस्ट →</a>' if i < n-1 else '') + '</span></div>'
        body = (f"<h1>{esc(heading)}</h1>" if heading else "") + "".join(card(p) for p in chunk) + pager
        write(path, layout(title or SITE, desc, path, body))

# --- pages ---
listing(posts, "/")
for p in posts + pages:
    tags = "".join(f'<a href="/label/{slug(l)}/">{esc(l)}</a>' for l in p["labels"])
    meta = f'<div class="meta">{p["pub"]}</div>' if p["type"] == "POST" else ""
    body = f'<article class="post"><h1>{esc(p["title"])}</h1>{meta}{p["content"]}</article>' + (f'<div class="tags">{tags}</div>' if tags else "")
    write(p["path"], layout(p["title"], p["desc"], p["path"], body, p["img"], p if p["type"] == "POST" else None))

labels = {}
for p in posts:
    for l in p["labels"]: labels.setdefault(l, []).append(p)
redirects = ["/feeds/posts/default /atom.xml 301", "/feeds/posts/summary /atom.xml 301"]
for l, items in labels.items():
    s = slug(l)
    listing(items, f"/label/{s}/", heading=f"Label: {l}", title=l)
    redirects.append(f"/search/label/{quote(l)} /label/{s}/ 301")
    redirects.append(f"/search/label/{quote(l)}/ /label/{s}/ 301")

write("/404.html", layout("पेज नहीं मिला", "Page not found", "/404.html", '<h1>404 — पेज नहीं मिला</h1><p><a href="/">होमपेज पर जाएं</a></p>', noindex=True))

# --- feed, sitemap, robots, ads.txt, redirects ---
atom = ['<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">',
        f"<title>{esc(SITE)}</title><id>{BASE}/</id><link href=\"{BASE}/\"/><link rel=\"self\" href=\"{BASE}/atom.xml\"/><updated>{posts[0]['upd']}T00:00:00Z</updated>"]
for p in posts[:25]:
    atom.append(f'<entry><title>{esc(p["title"])}</title><id>{BASE}{pretty(p["path"])}</id><link href="{BASE}{pretty(p["path"])}"/><published>{p["pub"]}T00:00:00Z</published><updated>{p["upd"]}T00:00:00Z</updated><summary>{esc(p["desc"])}</summary></entry>')
atom.append("</feed>"); write("/atom.xml", "".join(atom))

urls = [(BASE + "/", posts[0]["upd"])] + [(BASE + quote(pretty(p["path"])), p["upd"]) for p in pages + posts] + [(BASE + f"/label/{slug(l)}/", items[0]["upd"]) for l, items in labels.items()]
write("/sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{esc(u)}</loc><lastmod>{d}</lastmod></url>" for u, d in urls) + "</urlset>")
write("/robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
write("/ads.txt", f"google.com, pub-{ADSENSE.split('-')[-1]}, DIRECT, f08c47fec0942fa0\n")
write("/_redirects", "\n".join(redirects) + "\n")
write("/_headers", "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/*.html\n  Cache-Control: public, max-age=0, must-revalidate\n")
shutil.copy(ROOT / "static" / "favicon.ico", OUT / "favicon.ico")
print(f"{len(posts)} posts, {len(pages)} pages, {len(labels)} labels -> {OUT}")
