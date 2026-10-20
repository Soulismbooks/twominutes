#!/usr/bin/env python3
"""Blogger feed.atom -> static site in ./public (old Blogger URLs preserved)."""
import re, html, shutil, math
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

BASE = "https://www.twominutes.in"  # Canonical host: www; keep consistent across links, sitemap and feeds
SITE = "Two Minutes to Happiness & Wealth"
TAGLINE = "Quick 2-minute tips for a happy life & personal finance! Learn budgeting, saving, and investing at twominutes.in."
ADSENSE = "ca-pub-5852664798648088"
PER_PAGE = 10
ROOT = Path(__file__).parent
OUT = ROOT / "public"
NS = {"a": "http://www.w3.org/2005/Atom", "b": "http://schemas.google.com/blogger/2018"}

def normalize_blogger_path(p):
    # Blogger export can occasionally contain a duplicated .html suffix.
    while p.endswith(".html.html"):
        p = p[:-5]
    return p

def pretty(p):
    p = normalize_blogger_path(p)
    return p[:-5] if p.endswith(".html") else p
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
    d = dict(type=typ, path=normalize_blogger_path(fn), title=clean_title(e.findtext("a:title", namespaces=NS)),
             pub=(e.findtext("a:published", namespaces=NS) or "")[:10],
             upd=(e.findtext("a:updated", namespaces=NS) or "")[:10],
             content=tidy(c), desc=text_of(c), img=first_img(c),
             labels=[k.get("term") for k in e.findall("a:category", NS) if k.get("term")])
    (posts if typ == "POST" else pages).append(d)
posts.sort(key=lambda p: p["pub"], reverse=True)
pages.sort(key=lambda p: p["title"])

CSS = """:root{color-scheme:light;--bg:#f6f3eb;--fg:#24332c;--mut:#728078;--card:#fffefa;--acc:#66856e;--acc2:#9aaf91;--bd:#e5e2d8;--soft:#edf1e7;--shadow:0 8px 28px rgba(50,65,48,.07);--radius:18px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.8 system-ui,-apple-system,"Segoe UI","Noto Sans Devanagari",Roboto,sans-serif}
a{color:var(--acc);text-underline-offset:3px}a:hover{color:#055c42}
header.s{background:rgba(255,255,255,.97);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:20;backdrop-filter:blur(14px)}
.w{max-width:1160px;margin:0 auto;padding:0 22px}header.s .w{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:center;justify-content:space-between;padding-top:13px;padding-bottom:13px}
.logo{display:flex;align-items:center;gap:11px;font-weight:850;font-size:1.08rem;text-decoration:none;color:var(--fg);letter-spacing:-.35px;max-width:100%}
.logo:before{content:"2M";display:inline-grid;place-items:center;flex:0 0 38px;width:38px;height:38px;border-radius:12px;color:#fff;background:linear-gradient(135deg,#064e3b 0%,#43a61e 62%,#f5ad10 100%);box-shadow:0 5px 14px #66856e33;font-weight:900;font-size:.83rem;letter-spacing:-1px;border:1px solid #ffffff66}
nav{display:flex;flex-wrap:wrap;align-items:center;gap:3px 20px}nav a{color:#43564d;text-decoration:none;font-size:.92rem;font-weight:650;padding:6px 0;border-bottom:2px solid transparent}nav a:hover{color:var(--acc);border-bottom-color:var(--acc)}
main{padding:30px 0 64px}.hero{background:linear-gradient(120deg,#354b3d 0%,#66856e 58%,#a3b69a 100%);color:#fff;border-radius:26px;padding:clamp(26px,5.5vw,56px);margin:4px 0 34px;position:relative;overflow:hidden;box-shadow:0 18px 40px #66856e20}
.hero:after{content:"";position:absolute;width:300px;height:300px;border:1px solid #ffffff25;border-radius:50%;right:-80px;top:-105px;box-shadow:0 0 0 38px #ffffff0b,0 0 0 78px #ffffff08;pointer-events:none}
.eyebrow{font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;opacity:.84}.hero h1{font-size:clamp(2rem,5vw,3.45rem);line-height:1.16;letter-spacing:-1.25px;max-width:800px;margin:12px 0}.hero p{font-size:1.06rem;max-width:700px;color:#e2fff3;margin:14px 0 0}
.section-title{display:flex;gap:12px;align-items:end;justify-content:space-between;margin:34px 0 17px}.section-title h1,.section-title h2{font-size:1.4rem;margin:0;letter-spacing:-.4px}.section-title span{font-size:.87rem;color:var(--mut);white-space:nowrap}
.page-grid{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:28px;align-items:start}.primary{min-width:0}.sidebar{position:sticky;top:92px;display:grid;gap:16px}.sidebox{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:19px;box-shadow:var(--shadow)}.sidebox h2{font-size:1.04rem;margin:0 0 12px}.side-links{display:grid;gap:9px}.side-links a{color:var(--fg);text-decoration:none;font-size:.9rem;line-height:1.5}.side-links a:hover{color:var(--acc)}.side-links .count{float:right;color:var(--mut);font-size:.8rem}.tools-section{margin:8px 0 38px}.tools-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:17px}.tool-card{display:flex;position:relative;flex-direction:column;align-items:center;text-align:center;text-decoration:none;color:var(--fg);background:var(--card);border:1px solid var(--bd);border-radius:20px;padding:24px 17px 20px;min-height:228px;box-shadow:var(--shadow);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.tool-card:hover{transform:translateY(-3px);border-color:#afc6aa;box-shadow:0 16px 34px rgba(18,38,63,.1);color:var(--fg)}.tool-icon{display:grid;place-items:center;font-size:2.7rem;line-height:1.2;margin:4px 0 16px;width:76px;height:76px;border-radius:19px;background:linear-gradient(135deg,#edf1e7,#dce8d5)}.tool-free{position:absolute;right:12px;top:12px;border-radius:99px;padding:3px 11px;background:#e8f4ed;color:#28714d;font-size:.74rem;font-weight:850;letter-spacing:.4px}.tool-card h3{font-size:1.13rem;line-height:1.35;margin:0 0 5px;letter-spacing:-.2px}.tool-card p{font-size:.91rem;line-height:1.5;color:var(--mut);margin:0 0 13px}.tool-cta{margin-top:auto;color:var(--acc);font-size:.86rem;font-weight:800}.posts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.card{display:flex;flex-direction:column;position:relative;background:var(--card);border:1px solid var(--bd);border-radius:var(--radius);padding:23px 24px;margin:0;text-decoration:none;color:var(--fg);box-shadow:var(--shadow);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;min-height:190px}
.card:hover{transform:translateY(-3px);border-color:#c6d3bd;box-shadow:0 16px 34px rgba(18,38,63,.09);color:var(--fg)}
.card .thumb{display:block;width:calc(100% + 48px);margin:-23px -24px 17px;height:190px;object-fit:cover;background:#e9eee4;border-radius:var(--radius) var(--radius) 0 0}.card .thumb-fallback{display:grid;place-items:center;width:calc(100% + 48px);margin:-23px -24px 17px;height:190px;background:linear-gradient(135deg,#e9eee4,#d7e1d0);color:#66856e;font-size:2.4rem;border-radius:var(--radius) var(--radius) 0 0}.card .tag{display:inline-flex;align-self:flex-start;background:var(--soft);color:#526e58;border-radius:100px;padding:2px 11px;font-size:.75rem;font-weight:750;margin-bottom:11px}
.card h2{margin:0 0 8px;font-size:1.18rem;line-height:1.48;letter-spacing:-.2px}.card .meta{color:var(--mut);font-size:.81rem}.card p{margin:10px 0 0;color:#596b62;font-size:.92rem;line-height:1.72}
h1{line-height:1.3;font-size:clamp(1.8rem,4vw,2.5rem);letter-spacing:-.6px}h2,h3{line-height:1.4}
.post{background:#fff;border:1px solid var(--bd);border-radius:20px;padding:clamp(22px,4.5vw,44px);box-shadow:var(--shadow);overflow-wrap:anywhere}.post h1{margin-top:0;margin-bottom:8px}.post .meta{margin-bottom:24px}.post img{max-width:100%;height:auto!important;border-radius:11px}.post table{display:block;overflow-x:auto;max-width:100%}.post iframe{max-width:100%}.post p,.post li{line-height:1.9}.post h2,.post h3{margin-top:1.7em}
.tags{margin-top:22px}.tags a{display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border:1px solid var(--bd);background:#fff;border-radius:99px;font-size:.84rem;text-decoration:none}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:26px}.pager a{background:#fff;border:1px solid var(--bd);border-radius:11px;padding:8px 15px;text-decoration:none;font-weight:650}
footer{border-top:1px solid var(--bd);background:#fff;color:var(--mut);font-size:.9rem;padding:27px 0}footer .w{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
@media(min-width:980px){.posts{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:25px 27px}.card .thumb,.card .thumb-fallback{width:calc(100% + 54px);margin:-25px -27px 17px}}
@media(max-width:900px){.page-grid{grid-template-columns:minmax(0,1fr) 245px;gap:18px}}
@media(max-width:700px){.tools-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tool-card{padding:21px 11px 17px;min-height:216px}.tool-icon{font-size:2.35rem;width:65px;height:65px}.page-grid{grid-template-columns:1fr}.sidebar{position:static;grid-template-columns:1fr}.w{padding:0 14px}header.s .w{gap:9px}.posts{grid-template-columns:1fr;gap:13px}.card{min-height:0;padding:19px}.card .thumb,.card .thumb-fallback{width:calc(100% + 38px);margin:-19px -19px 15px;height:205px}.hero{border-radius:19px;margin-bottom:26px}.section-title{margin-top:27px}.section-title h1,.section-title h2{font-size:1.25rem}nav{gap:2px 13px}nav a{font-size:.84rem}.logo{font-size:.97rem}.post{border-radius:16px}}
@media(max-width:390px){.logo{font-size:.9rem;gap:8px}.logo:before{width:34px;height:34px;flex-basis:34px}nav{gap:2px 10px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important}}
"""

def layout(title, desc, path, body, img=None, article=None, noindex=False):
    full = f"{title} | {SITE}" if path not in ("/",) else SITE
    url = BASE + quote(pretty(path), safe="/%")
    og = f'<meta property="og:image" content="{esc(img)}">' if img else ""
    art = f'<meta property="article:published_time" content="{article["pub"]}"><meta property="article:modified_time" content="{article["upd"]}">' if article else ""
    nav = "".join(f'<a href="{esc(pretty(p["path"]))}">{esc(short(p["title"]))}</a>' for p in pages if p["path"] != "/p/2-minute-tips.html") + '<a href="/p/2-minute-tips">Contact</a>'
    category_counts = {}
    for post in posts:
        for label in post["labels"]:
            category_counts[label] = category_counts.get(label, 0) + 1
    categories_html = "".join(f'<a href="/label/{slug(label)}/">{esc(label)}<span class="count">{count}</span></a>' for label, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))[:8])
    popular_html = "".join(f'<a href="{esc(pretty(post["path"]))}">{esc(post["title"])}</a>' for post in posts[:5])
    sidebar = f'<aside class="sidebar"><section class="sidebox"><h2>श्रेणियाँ</h2><div class="side-links">{categories_html or "<span>जल्द उपलब्ध</span>"}</div></section><section class="sidebox"><h2>लोकप्रिय लेख</h2><div class="side-links">{popular_html}</div></section><section class="sidebox"><h2>Two Minutes</h2><p style="font-size:.9rem;line-height:1.7;margin:0;color:var(--mut)">बेहतर जीवन और समझदारी से पैसे के फैसलों के लिए छोटे, उपयोगी विचार।</p></section></aside>'
    page_body = f'<div class="page-grid"><section class="primary">{body}</section>{sidebar}</div>'
    return f"""<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(full)}</title><meta name="description" content="{esc(desc)}"><link rel="canonical" href="{esc(url)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{esc(url)}"><meta property="og:type" content="{'article' if article else 'website'}"><meta property="og:site_name" content="{esc(SITE)}">{og}{art}
<meta name="twitter:card" content="summary_large_image"><link rel="alternate" type="application/atom+xml" title="{esc(SITE)}" href="/atom.xml"><link rel="icon" href="/favicon.ico">
<style>{CSS}</style><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={ADSENSE}" crossorigin="anonymous"></script>
</head><body><header class="s"><div class="w"><a class="logo" href="/">{esc(SITE)}</a><nav>{nav}</nav></div></header>
<main class="w">{page_body}</main><footer><div class="w"><span>© {esc(SITE)} · छोटे कदम, बेहतर जीवन।</span><span><a href="/atom.xml">RSS Feed</a> · <a href="/sitemap.xml">Sitemap</a></span></div></footer></body></html>"""

def write(path, content):
    p = OUT / path.lstrip("/")
    if path.endswith("/"): p = p / "index.html"
    p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content, encoding="utf-8")

def card(p):
    label = p["labels"][0] if p["labels"] else "Two Minutes"
    if p["img"]:
        thumb = f'<img class="thumb" src="{esc(p["img"])}" alt="{esc(p["title"])}" loading="lazy">'
    else:
        thumb = f'<span class="thumb-fallback" aria-hidden="true">✦</span>'
    return f'<a class="card" href="{esc(pretty(p["path"]))}">{thumb}<span class="tag">{esc(label)}</span><h2>{esc(p["title"])}</h2><div class="meta">{p["pub"]}</div><p>{esc(p["desc"])}</p></a>'

def listing(items, base, heading=None, title=None, desc=TAGLINE, homepage=False):
    n = max(1, math.ceil(len(items) / PER_PAGE))
    for i in range(n):
        chunk = items[i*PER_PAGE:(i+1)*PER_PAGE]
        path = base if i == 0 else f"{base}page/{i+1}/"
        pager = '<div class="pager"><span>' + (f'<a href="{base if i==1 else base+"page/"+str(i)+"/"}">← नए पोस्ट</a>' if i else '') + '</span><span>' + (f'<a href="{base}page/{i+2}/">और पोस्ट →</a>' if i < n-1 else '') + '</span></div>'
        if homepage and i == 0:
            tools = (
                '<section class="tools-section" aria-labelledby="tools-heading">'
                '<div class="section-title"><h2 id="tools-heading">Useful Calculators</h2><span>Free tools · बिल्कुल मुफ्त</span></div>'
                '<div class="tools-grid">'
                '<a class="tool-card" href="/p/sip-calculator-online-monthly-sip"><span class="tool-icon" aria-hidden="true">📈</span><span class="tool-free">FREE</span><h3>SIP Calculator</h3><p>Monthly SIP से कितना बनेगा?</p><span class="tool-cta">कैलकुलेटर खोलें →</span></a>'
                '<a class="tool-card" href="/p/emi-calculator-online"><span class="tool-icon" aria-hidden="true">🏦</span><span class="tool-free">FREE</span><h3>EMI Calculator</h3><p>Loan की EMI अभी जानें</p><span class="tool-cta">कैलकुलेटर खोलें →</span></a>'
                '<a class="tool-card" href="/p/twominutes-happiness-calculator-2"><span class="tool-icon" aria-hidden="true">😊</span><span class="tool-free">FREE</span><h3>Happiness Calculator</h3><p>अपनी खुशी का स्कोर जानें</p><span class="tool-cta">कैलकुलेटर खोलें →</span></a>'
                '</div></section>'
            )
            intro = f'<section class="hero"><div class="eyebrow">खुशी और आर्थिक समझ · 2 मिनट में</div><h1>छोटे कदम, बेहतर जीवन और मजबूत आर्थिक भविष्य</h1><p>जीवन को सरल बनाने, पैसे को समझने और बेहतर फैसले लेने के लिए उपयोगी विचार—बिना उलझाव, सिर्फ काम की बात।</p></section>' + tools + f'<div class="section-title"><h2>नए लेख और उपयोगी सुझाव</h2><span>{len(items)} लेख</span></div>'
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