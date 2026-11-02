"""Noticias vía RSS/Atom (Bing Noticias, blogs…).

Se usa para Pokémon Center, cuya web bloquea cualquier acceso automatizado: en
lugar de intentar saltarse esa protección, PokéRadar vigila las noticias que
anuncian sus lanzamientos y colecciones exclusivas.
"""
from __future__ import annotations

import hashlib
import html
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from ..filters import fold, is_relevant, matches_any
from ..http import Blocked, PoliteClient
from ..models import Product, parse_iso


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child(el: ET.Element, *names: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) in names:
            return c
    return None


def _text(el: ET.Element, *names: str) -> str:
    c = _child(el, *names)
    return html.unescape((c.text or "").strip()) if c is not None else ""


def _date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return parse_iso(value)


def _real_link(link: str) -> str:
    """Bing envuelve los enlaces (apiclick.aspx?url=…): devolvemos el del medio."""
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(link).query)
    return q["url"][0] if "url" in q and q["url"][0].startswith("http") else link


def parse_feed(body: bytes) -> list[dict[str, Any]]:
    root = ET.fromstring(body)
    entries = [e for e in root.iter() if _local(e.tag) in ("item", "entry")]
    out = []
    for e in entries:
        link = _text(e, "link")
        if not link:  # Atom: <link href="…"/>
            le = _child(e, "link")
            link = le.get("href", "") if le is not None else ""
        img = _text(e, "image")
        if not img:
            enc = _child(e, "enclosure", "thumbnail", "content")
            img = enc.get("url", "") if enc is not None else ""
        out.append({
            "title": _text(e, "title"),
            "link": _real_link(link),
            "date": _date(_text(e, "pubdate", "published", "updated", "date")),
            "source": _text(e, "source"),
            "description": _text(e, "description", "summary"),
            "image": img or None,
        })
    return out


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any]) -> list[Product]:
    flt = cfg.get("filters", {})
    max_age = timedelta(days=int(store.get("max_age_days", 21)))
    now = datetime.now(timezone.utc)
    seen: set[str] = set()
    out: list[Product] = []
    errors: list[str] = []
    working = 0
    for feed in store.get("feeds", []):
        try:
            body = client.get(feed)
            if not body.strip():  # Bing a veces responde vacío: un único reintento
                body = client.get(feed)
            if body.lstrip()[:15].lower().startswith((b"<!doctype html", b"<html")):
                raise Blocked("devuelve una página web en lugar del feed RSS")
            entries = parse_feed(body) if body.strip() else []
            working += 1
        except Exception as e:  # un feed caído no debe tumbar los demás
            errors.append(f"{feed[:60]}…: {e}")
            continue
        for it in entries:
            title = it["title"]
            text = f"{title}"
            exclude = [*flt.get("exclude", []), *store.get("exclude", [])]
            # pokemon_only: medios dedicados a Pokémon cuyos titulares no siempre dicen "Pokémon"
            if not title or matches_any(text, exclude) or (
                    not store.get("pokemon_only") and not is_relevant(text, ["pokemon"], exclude)):
                continue
            ft = fold(text)
            if any(fold(w) not in ft for w in store.get("must_include", [])):
                continue
            if store.get("must_include_any") and not matches_any(text, store["must_include_any"]):
                continue
            if it["date"] and now - it["date"] > max_age:
                continue
            key = hashlib.sha1(fold(title).encode()).hexdigest()[:16]
            if key in seen:
                continue
            seen.add(key)
            src = it["source"] or urllib.parse.urlsplit(it["link"]).netloc.removeprefix("www.")
            out.append(Product(
                id=f"{store['id']}:{key}",
                store=store["id"],
                title=title,
                url=it["link"],
                image=it["image"],
                created=it["date"].isoformat() if it["date"] else None,
                kind="news",
                category="noticia",
                source=src,
            ))
    if errors and not working:   # solo falla si NINGÚN feed responde
        if all("página web en lugar del feed" in e for e in errors):
            raise Blocked("los feeds devuelven una página web en lugar de RSS")
        raise RuntimeError("; ".join(errors))
    return out
