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
def short(t): return t if len(t) <= 22 else t[:20].rstrip() + "…"
def clean_title(t): return html.unescape(t or "").strip()
def esc(s): return html.escape(s, quote=True)
def slug(s):
    s = re.sub(r"[^\w\u0900-\u097F]+", "-", (s or "").strip().lower()).strip("-")
    return s or "label"
def tidy(c):
    def fix(m):
        st = re.sub(r"(font-family|font-size|line-height|white-space-collapse|font-variant[\w-]*)\s*:[^;\"]*;?", "", m.group(1)).strip()
        return f'style="{st}"' if st else ""
    c = re.sub(r'style="([^"]*)"', fix, c)
    c = re.sub(r"<img ", '<img loading="lazy" ', c)
    return c
def text_of(c, n=160):
    c = re.sub(r"(?is)<(style|script)\b.*?</\1>", " ", c)
    t = html.unescape(re.sub(r"<[^>]+>", " ", c)); t = re.sub(r"\s+", " ", t).strip()
    return (t[:n].rsplit(" ", 1)[0] + "…") if len(t) > n else t
def first_img(c):
    m = re.search(r'<img[^>]+src="([^"]+)"', c)
    return re.sub(r"/s\d+/", "/s1200/", m.group(1)) if m else None

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

CSS = """:root{color-scheme:light;--bg:#f7f8fa;--fg:#182230;--mut:#657184;--card:#fff;--acc:#087f5b;--acc2:#0c946a;--bd:#e2e8f0;--soft:#e7f7f0;--shadow:0 8px 24px rgba(18,38,63,.055)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.8 system-ui,-apple-system,"Segoe UI","Noto Sans Devanagari",Roboto,sans-serif}
a{color:var(--acc);text-underline-offset:3px}a:hover{color:#055c42}
header.s{background:rgba(255,255,255,.96);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:10;backdrop-filter:blur(14px)}
.w{max-width:1060px;margin:0 auto;padding:0 20px}header.s .w{display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;justify-content:space-between;padding-top:14px;padding-bottom:14px}
.logo{display:flex;align-items:center;gap:10px;font-weight:850;font-size:1.1rem;text-decoration:none;color:var(--fg);letter-spacing:-.35px}
.logo:before{content:"2";display:inline-grid;place-items:center;width:36px;height:36px;border-radius:12px;color:#fff;background:linear-gradient(135deg,#087f5b,#21b98b);box-shadow:0 5px 14px #087f5b33}
nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 18px}nav a{color:#435066;text-decoration:none;font-size:.93rem;font-weight:650;padding:5px 0}nav a:hover{color:var(--acc)}
main{padding:28px 0 56px}.hero{background:linear-gradient(125deg,#073f37,#087f5b 57%,#20a77c);color:#fff;border-radius:24px;padding:clamp(24px,5vw,48px);margin:4px 0 32px;position:relative;overflow:hidden;box-shadow:0 18px 38px #087f5b25}
.hero:after{content:"";position:absolute;width:260px;height:260px;border:1px solid #ffffff25;border-radius:50%;right:-70px;top:-95px;box-shadow:0 0 0 35px #ffffff0b,0 0 0 70px #ffffff08}
.eyebrow{font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:1.8px;opacity:.82}.hero h1{font-size:clamp(1.9rem,5vw,3.2rem);line-height:1.18;letter-spacing:-1.2px;max-width:740px;margin:12px 0}.hero p{font-size:1.07rem;max-width:680px;color:#e2fff3;margin:12px 0 0}
.section-title{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:32px 0 16px}.section-title h2{font-size:1.35rem;margin:0;letter-spacing:-.35px}.section-title span{font-size:.9rem;color:var(--mut)}
.posts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:20px 21px;margin:0;text-decoration:none;color:var(--fg);box-shadow:var(--shadow);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;min-height:170px}
.card:hover{transform:translateY(-3px);border-color:#a7dbc7;box-shadow:0 14px 30px rgba(18,38,63,.09);color:var(--fg)}
.card .tag{display:inline-flex;align-self:flex-start;background:var(--soft);color:#086749;border-radius:100px;padding:2px 10px;font-size:.76rem;font-weight:750;margin-bottom:10px}
.card h2{margin:0 0 8px;font-size:1.15rem;line-height:1.5;letter-spacing:-.15px}.card .meta{color:var(--mut);font-size:.82rem}.card p{margin:9px 0 0;color:#596679;font-size:.93rem;line-height:1.75}
h1{line-height:1.3;font-size:clamp(1.75rem,4vw,2.4rem);letter-spacing:-.6px}h2,h3{line-height:1.4}
.meta{color:var(--mut);font-size:.9rem}.post{background:#fff;border:1px solid var(--bd);border-radius:18px;padding:clamp(20px,4vw,38px);box-shadow:var(--shadow);overflow-wrap:anywhere}.post h1{margin-top:0}.post img{max-width:100%;height:auto!important;border-radius:10px}.post table{display:block;overflow-x:auto;max-width:100%}.post iframe{max-width:100%}
.tags{margin-top:22px}.tags a{display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border:1px solid var(--bd);background:#fff;border-radius:99px;font-size:.84rem;text-decoration:none}
.pager{display:flex;justify-content:space-between;margin-top:24px}.pager a{background:#fff;border:1px solid var(--bd);border-radius:10px;padding:8px 14px;text-decoration:none;font-weight:650}
footer{border-top:1px solid var(--bd);background:#fff;color:var(--mut);font-size:.9rem;padding:24px 0}footer .w{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
@media(max-width:700px){.w{padding:0 14px}header.s .w{gap:10px}.posts{grid-template-columns:1fr}.card{min-height:0;padding:18px}.hero{border-radius:18px;margin-bottom:26px}.section-title{margin-top:26px}nav{gap:3px 12px}nav a{font-size:.86rem}.logo{font-size:1rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important}}"""

def layout(title, desc, path, body, img=None, article=None, noindex=False):
    full = f"{title} | {SITE}" if path not in ("/",) else SITE
    url = BASE + quote(pretty(path), safe="/%")
    og = f'<meta property="og:image" content="{esc(img)}">' if img else ""
    art = f'<meta property="article:published_time" content="{article["pub"]}"><meta property="article:modified_time" content="{article["upd"]}">' if article else ""
    nav = "".join(f'<a href="{esc(pretty(p["path"]))}">{esc(short(p["title"]))}</a>' for p in pages if p["path"] != "/p/2-minute-tips.html") + '<a href="/p/2-minute-tips">Contact</a>'
    return f"""<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(full)}</title><meta name="description" content="{esc(desc)}"><link rel="canonical" href="{esc(url)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{esc(url)}"><meta property="og:type" content="{'article' if article else 'website'}"><meta property="og:site_name" content="{esc(SITE)}">{og}{art}
<meta name="twitter:card" content="summary_large_image"><link rel="alternate" type="application/atom+xml" title="{esc(SITE)}" href="/atom.xml"><link rel="icon" href="/favicon.ico">
<style>{CSS}</style><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={ADSENSE}" crossorigin="anonymous"></script>
</head><body><header class="s"><div class="w"><a class="logo" href="/">{esc(SITE)}</a><nav>{nav}</nav></div></header>
<main class="w">{body}</main><footer><div class="w"><span>© {esc(SITE)} · छोटे कदम, बेहतर जीवन।</span><span><a href="/atom.xml">RSS Feed</a> · <a href="/sitemap.xml">Sitemap</a></span></div></footer></body></html>"""

def write(path, content):
    p = OUT / path.lstrip("/")
    if path.endswith("/"): p = p / "index.html"
    p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content, encoding="utf-8")

def card(p):
    label = p["labels"][0] if p["labels"] else "Two Minutes"
    return f'<a class="card" href="{esc(pretty(p["path"]))}"><span class="tag">{esc(label)}</span><h2>{esc(p["title"])}</h2><div class="meta">{p["pub"]}</div><p>{esc(p["desc"])}</p></a>'

def listing(items, base, heading=None, title=None, desc=TAGLINE, homepage=False):
    n = max(1, math.ceil(len(items) / PER_PAGE))
    for i in range(n):
        chunk = items[i*PER_PAGE:(i+1)*PER_PAGE]
        path = base if i == 0 else f"{base}page/{i+1}/"
        pager = '<div class="pager"><span>' + (f'<a href="{base if i==1 else base+"page/"+str(i)+"/"}">← नए पोस्ट</a>' if i else '') + '</span><span>' + (f'<a href="{base}page/{i+2}/">और पोस्ट →</a>' if i < n-1 else '') + '</span></div>'
        if homepage and i == 0:
            intro = f'<section class="hero"><div class="eyebrow">खुशी और आर्थिक समझ · 2 मिनट में</div><h1>छोटे कदम, बेहतर जीवन और मजबूत आर्थिक भविष्य</h1><p>जीवन को सरल बनाने, पैसे को समझने और बेहतर फैसले लेने के लिए उपयोगी विचार—बिना उलझाव, सिर्फ काम की बात।</p></section><div class="section-title"><h2>नए लेख और उपयोगी सुझाव</h2><span>{len(items)} लेख</span></div>'
        else:
            intro = (f'<div class="section-title"><h1>{esc(heading)}</h1><span>{len(items)} लेख</span></div>' if heading else '')
        body = intro + '<div class="posts">' + "".join(card(p) for p in chunk) + '</div>' + pager
        write(path, layout(title or SITE, desc, path, body))

listing(posts, "/", homepage=True)
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
    listing(items, f"/label/{s}/", heading=f"विषय: {l}", title=l)
    redirects.extend([f"/search/label/{quote(l)} /label/{s}/ 301", f"/search/label/{quote(l)}/ /label/{s}/ 301"])

write("/404.html", layout("पेज नहीं मिला", "Page not found", "/404.html", '<div class="hero"><h1>404 — पेज नहीं मिला</h1><p>यह पेज उपलब्ध नहीं है। होमपेज से अपनी पसंद की जानकारी खोजें।</p><p><a style="color:white;font-weight:800" href="/">होमपेज पर लौटें →</a></p></div>', noindex=True))
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