#!/usr/bin/env python3
"""Genera le mini-pagine /og/<slug>/ per ogni brano di playlist.json.

Ogni pagina serve l'anteprima sociale giusta (og:image = copertina
dell'album, og:title = titolo del brano) per WhatsApp/Telegram/Instagram
e reindirizza subito all'app con il brano avviato.

Eseguire dopo ogni modifica a playlist.json:
    python3 tools/genera_og_pagine.py
"""
import json, os, unicodedata, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAYLIST = os.path.join(ROOT, "src", "playlist.json")
OUT = os.path.join(ROOT, "og")
BASE = "https://marcothefaze.github.io/myplayer"


def title_from_file(file):
    name = os.path.basename(file).rsplit(".", 1)[0]
    return name or "Brano"


def slug_from_file(file):
    base = os.path.basename(file).rsplit(".", 1)[0]
    slug = (
        unicodedata.normalize("NFD", base)
        .encode("ascii", "ignore")
        .decode()
        .lower()
    )
    slug = "".join(c if c.isalnum() else "-" for c in slug)
    slug = "-".join(s for s in slug.split("-") if s)
    return (slug or "brano")[:60]


def main():
    songs = json.load(open(PLAYLIST, encoding="utf-8"))
    used = {}
    pages = []
    for i, song in enumerate(songs):
        title = song.get("titolo") or title_from_file(song.get("file", ""))
        album = song.get("album") or "Senza album"
        cover = song.get("copertina")
        slug = slug_from_file(song.get("file", ""))
        n = used.get(slug, 0)
        used[slug] = n + 1
        if n:
            slug = f"{slug}-{n + 1}"

        og_url = f"{BASE}/og/{slug}/"
        target = "../../src/index.html?track=" + urllib.parse.quote(
            song.get("file", ""), safe=""
        )
        enc_title = title.replace("&", "&amp;").replace("<", "&lt;").replace("&", "&amp;")
        desc = f"Album: {album} - SSG Universe".replace("&", "&amp;").replace("<", "&lt;")

        img_tags = ""
        if cover:
            img = f"{BASE}/{cover}"
            img_tags = (
                f'  <meta property="og:image" content="{img}">\n'
                f'  <meta name="twitter:card" content="summary_large_image">\n'
            )

        html = f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a10">
  <title>{enc_title} - SSG Universe</title>
  <meta property="og:type" content="music.song">
  <meta property="og:title" content="{enc_title} - SSG Universe">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{og_url}">
  <meta property="og:site_name" content="SSG Universe">
  <meta property="og:music:album" content="{album.replace('&', '&amp;').replace('<', '&lt;')}">
{img_tags}  <meta http-equiv="refresh" content="0;url={target}">
  <style>body{{font-family:system-ui,sans-serif;background:#0a0a10;color:#cfcfe8;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}}
  a{{color:#9aa0ff;font-weight:700}}</style>
</head>
<body>
  <p>{enc_title}</p>
  <p><a href="{target}">Apri nell'app SSG Universe</a></p>
  <script>location.replace("{target}");</script>
</body>
</html>
"""
        path = os.path.join(OUT, slug, "index.html")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        pages.append(f"og/{slug}/ <- {title}")

    print(f"Generati {len(pages)} pagine in /og/")
    for p in pages[:5]:
        print("  ", p)


if __name__ == "__main__":
    main()